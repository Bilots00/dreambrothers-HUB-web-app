import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, Trash2, Clapperboard, Copy, ExternalLink, Sparkles, Flame,
} from "lucide-react";

// Video Editing → Creative
//
// La sala di montaggio del mattino: qui atterrano i video che l'agente ha
// prodotto stanotte. Ogni creative si guarda, si legge l'hook, e si decide.
// Niente parte per TikTok da solo: da "draft" si passa a "approved" solo con un
// clic di Andrea (regola 5 della costituzione).

type Filtro = "tutti" | "draft" | "approved" | "rejected" | "published";

const FILTRI: { key: Filtro; label: string }[] = [
  { key: "draft", label: "Da revisionare" },
  { key: "approved", label: "Approvati" },
  { key: "published", label: "Pubblicati" },
  { key: "rejected", label: "Scartati" },
  { key: "tutti", label: "Tutti" },
];

const COLORE_STATO: Record<string, string> = {
  draft: "oklch(0.72 0.18 75)",
  approved: "oklch(0.6 0.18 145)",
  scheduled: "oklch(0.65 0.2 265)",
  published: "oklch(0.65 0.2 195)",
  rejected: "oklch(0.55 0.22 25)",
};

function copia(testo: string, cosa: string) {
  navigator.clipboard.writeText(testo).then(
    () => toast.success(`${cosa} copiato`),
    () => toast.error("Copia non riuscita"),
  );
}

export default function VideoCreative() {
  const [filtro, setFiltro] = useState<Filtro>("draft");
  const [noteAperte, setNoteAperte] = useState<Record<number, string>>({});

  const utils = trpc.useUtils();
  const { data: drafts, isLoading } = trpc.video.draftsList.useQuery(undefined, { refetchInterval: 60_000 });
  const { data: config } = trpc.video.config.useQuery();

  const invalida = () => utils.video.draftsList.invalidate();
  const update = trpc.video.draftUpdate.useMutation({ onSuccess: invalida });
  const rimuovi = trpc.video.draftDelete.useMutation({ onSuccess: invalida });

  const lista = useMemo(() => {
    const tutti = drafts ?? [];
    return filtro === "tutti" ? tutti : tutti.filter((d) => d.status === filtro);
  }, [drafts, filtro]);

  const conteggi = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of drafts ?? []) c[d.status] = (c[d.status] ?? 0) + 1;
    return c;
  }, [drafts]);

  return (
    <div className="space-y-6">
      {/* Intestazione */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Clapperboard className="w-5 h-5" style={{ color: "oklch(0.7 0.19 30)" }} />
            Creative Video
          </h1>
          <p className="text-sm text-muted-foreground">
            Quello che il Video Editor ha montato stanotte. Approvi tu, poi va in campagna.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {config?.autopilot ? (
            <Badge style={{ background: "oklch(0.6 0.18 145 / 0.15)", color: "oklch(0.7 0.18 145)", border: "none" }}>
              Automazione accesa · {config.dailyCount}/notte · {config.engine}
            </Badge>
          ) : (
            <Badge style={{ background: "oklch(0.5 0.02 260 / 0.2)", color: "oklch(0.6 0.02 260)", border: "none" }}>
              Automazione spenta
            </Badge>
          )}
        </div>
      </div>

      {/* Filtri */}
      <div className="flex gap-2 flex-wrap">
        {FILTRI.map((f) => (
          <button
            key={f.key}
            onClick={() => setFiltro(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filtro === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            }`}
          >
            {f.label}
            {f.key !== "tutti" && conteggi[f.key] ? ` (${conteggi[f.key]})` : ""}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carico i creative…</p>}

      {!isLoading && lista.length === 0 && (
        <Card className="p-8 text-center">
          <Sparkles className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-medium">Nessun creative in questa vista.</p>
          <p className="text-xs text-muted-foreground mt-1">
            {config?.autopilot
              ? "L'agente gira di notte: i video del prossimo run compaiono qui domattina."
              : "L'automazione è spenta. Accendila in Video Editing → Automazione."}
          </p>
        </Card>
      )}

      {/* Griglia creative */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {lista.map((d) => (
          <Card key={d.id} className="overflow-hidden flex flex-col">
            {/* Player — verticale, come lo vedrà chi scrolla TikTok */}
            <div className="relative bg-black" style={{ aspectRatio: d.aspect === "1:1" ? "1/1" : "9/16" }}>
              {d.videoUrl ? (
                <video
                  src={d.videoUrl}
                  poster={d.thumbUrl ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                  video mancante
                </div>
              )}
              <div className="absolute top-2 left-2 flex gap-1.5">
                <Badge
                  className="text-[10px] px-1.5 py-0 h-5"
                  style={{ background: `${COLORE_STATO[d.status] ?? "oklch(0.5 0.02 260)"} / 0.2`, color: COLORE_STATO[d.status], border: "none" }}
                >
                  {d.status}
                </Badge>
                {d.viralityScore != null && (
                  <Badge
                    className="text-[10px] px-1.5 py-0 h-5 flex items-center gap-1"
                    style={{ background: "oklch(0.7 0.19 30 / 0.2)", color: "oklch(0.75 0.19 30)", border: "none" }}
                  >
                    <Flame className="w-3 h-3" /> {d.viralityScore}
                  </Badge>
                )}
              </div>
            </div>

            <div className="p-4 space-y-3 flex-1 flex flex-col">
              <div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-1">
                  <span className="uppercase tracking-wide">{d.format}</span>
                  {d.angle && <><span>·</span><span>{d.angle}</span></>}
                  {d.durationSec && <><span>·</span><span>{d.durationSec}s</span></>}
                </div>
                <p className="text-sm font-semibold leading-snug">{d.hook || d.title || "(senza hook)"}</p>
              </div>

              {d.caption && (
                <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">{d.caption}</div>
              )}

              {d.critique && (
                <div
                  className="text-[11px] rounded-lg p-2 leading-relaxed"
                  style={{ background: "oklch(0.72 0.18 75 / 0.08)", color: "oklch(0.75 0.15 75)" }}
                >
                  <span className="font-semibold">Critica: </span>{d.critique}
                </div>
              )}

              {/* Note di Andrea — tornano all'agente come correzione umana */}
              <Textarea
                placeholder="Nota per l'agente (cosa cambiare la prossima volta)…"
                className="text-xs min-h-[52px]"
                value={noteAperte[d.id] ?? d.notes ?? ""}
                onChange={(e) => setNoteAperte((n) => ({ ...n, [d.id]: e.target.value }))}
                onBlur={() => {
                  const v = noteAperte[d.id];
                  if (v !== undefined && v !== (d.notes ?? "")) update.mutate({ id: d.id, notes: v });
                }}
              />

              <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-1">
                {d.status !== "approved" && (
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    style={{ background: "oklch(0.6 0.18 145)", color: "white" }}
                    onClick={() => update.mutate({ id: d.id, status: "approved" })}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approva
                  </Button>
                )}
                {d.status !== "rejected" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => update.mutate({ id: d.id, status: "rejected" })}
                  >
                    <XCircle className="w-3.5 h-3.5 mr-1" /> Scarta
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => copia([d.caption ?? "", d.hashtags ?? ""].filter(Boolean).join("\n\n"), "Caption")}
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                {d.videoUrl && (
                  <a href={d.videoUrl} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="ghost" className="h-8 text-xs">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                  </a>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs ml-auto text-muted-foreground"
                  onClick={() => rimuovi.mutate({ id: d.id })}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
