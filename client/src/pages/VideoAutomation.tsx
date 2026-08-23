import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Moon, Save, Wand2, AlertTriangle } from "lucide-react";

// Video Editing → Automazione
//
// Questa pagina è l'INTERRUTTORE. L'agente notturno la legge come prima cosa
// (GET /api/video/config): se "autopilot" è false si ferma prima di consumare
// un solo credito del motore video. Tutto il resto qui è il brief permanente —
// cosa montare, con che angoli, su quali prodotti e reference.

type Motore = "tinker" | "ffmpeg" | "resolve" | "capcut";

const MOTORI: { key: Motore; label: string; nota: string }[] = [
  { key: "tinker", label: "Tinker + montaggio (gratis)", nota: "Il Creative Director genera clip e B-roll in Tinker su Android, il Video Editor le monta e ci mette i sottotitoli." },
  { key: "ffmpeg", label: "ffmpeg (asset esistenti)", nota: "Slideshow/motion da immagini prodotto. Non ancora implementato." },
  { key: "resolve", label: "DaVinci Resolve (PC)", nota: "Qualità pro, ma richiede PC acceso + Resolve Studio." },
  { key: "capcut", label: "CapCut (PC)", nota: "Motore organico/shorts. Richiede PC acceso + CapCut aperto." },
];

export default function VideoAutomation() {
  const utils = trpc.useUtils();
  const { data: config, isLoading } = trpc.video.config.useQuery();
  const salva = trpc.video.setConfig.useMutation({
    onSuccess: () => {
      utils.video.config.invalidate();
      toast.success("Configurazione salvata");
    },
    onError: (e) => toast.error(e.message),
  });

  const [form, setForm] = useState<{
    engine: Motore; dailyCount: number; aspect: string; durationSec: number;
    angles: string; products: string; referenceUrls: string; brandNotes: string;
  }>({
    engine: "tinker",
    dailyCount: 3,
    aspect: "9:16",
    durationSec: 15,
    angles: "",
    products: "",
    referenceUrls: "",
    brandNotes: "",
  });

  useEffect(() => {
    if (!config) return;
    setForm({
      engine: config.engine as Motore,
      dailyCount: config.dailyCount,
      aspect: config.aspect,
      durationSec: config.durationSec,
      angles: config.angles,
      products: config.products,
      referenceUrls: config.referenceUrls,
      brandNotes: config.brandNotes,
    });
  }, [config]);

  if (isLoading || !config) return <p className="text-sm text-muted-foreground">Carico…</p>;

  const acceso = config.autopilot;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Moon className="w-5 h-5" style={{ color: "oklch(0.7 0.19 30)" }} />
          Automazione notturna
        </h1>
        <p className="text-sm text-muted-foreground">
          Il Video Editor gira ogni notte e ti lascia i creative pronti in "Creative".
        </p>
      </div>

      {/* L'interruttore */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Label className="text-base font-semibold">Genera creative ogni notte</Label>
              {acceso && (
                <Badge
                  className="text-[10px] px-1.5 py-0 h-5"
                  style={{ background: "oklch(0.6 0.18 145 / 0.15)", color: "oklch(0.7 0.18 145)", border: "none" }}
                >
                  attiva
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Quando è spento l'agente si ferma subito, senza consumare crediti del motore.
            </p>
          </div>
          <Switch
            checked={acceso}
            onCheckedChange={(v) => salva.mutate({ autopilot: v })}
          />
        </div>

        {/* Acceso ma muto è il guasto più probabile: si distingue qui. */}
        {acceso && !config.agentOnline && (
          <div
            className="mt-4 flex items-start gap-2 text-xs rounded-lg p-3"
            style={{ background: "oklch(0.72 0.18 75 / 0.08)", color: "oklch(0.78 0.15 75)" }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              L'interruttore è acceso ma l'agente non dà segni di vita
              {config.lastSeen ? ` da ${new Date(config.lastSeen).toLocaleString("it-IT")}` : " (mai visto)"}.
              Controlla che il cron sia installato e che <code>VIDEO_BASE_URL</code> / <code>CARE_WEBHOOK_SECRET</code> arrivino al processo.
            </span>
          </div>
        )}
      </Card>

      {/* Motore */}
      <Card className="p-5 space-y-3">
        <Label className="text-sm font-semibold">Motore di montaggio</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {MOTORI.map((m) => (
            <button
              key={m.key}
              onClick={() => setForm((f) => ({ ...f, engine: m.key }))}
              className={`text-left p-3 rounded-xl border transition-colors ${
                form.engine === m.key ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
              }`}
            >
              <div className="text-sm font-medium">{m.label}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{m.nota}</div>
            </button>
          ))}
        </div>
      </Card>

      {/* Parametri del batch */}
      <Card className="p-5 grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Video per notte</Label>
          <Input
            type="number"
            min={1}
            max={10}
            value={form.dailyCount}
            onChange={(e) => setForm((f) => ({ ...f, dailyCount: Number(e.target.value) }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Formato</Label>
          <Input value={form.aspect} onChange={(e) => setForm((f) => ({ ...f, aspect: e.target.value }))} placeholder="9:16" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Durata (secondi)</Label>
          <Input
            type="number"
            min={5}
            max={60}
            value={form.durationSec}
            onChange={(e) => setForm((f) => ({ ...f, durationSec: Number(e.target.value) }))}
          />
        </div>
      </Card>

      {/* Il brief permanente */}
      <Card className="p-5 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Angoli (uno per riga)</Label>
          <Textarea
            rows={5}
            className="text-xs font-mono"
            value={form.angles}
            onChange={(e) => setForm((f) => ({ ...f, angles: e.target.value }))}
          />
          <p className="text-[11px] text-muted-foreground">
            L'agente ne sceglie uno diverso per creative e evita quelli usati nelle notti recenti.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Prodotti da promuovere (uno per riga: handle o URL Shopify)</Label>
          <Textarea
            rows={4}
            className="text-xs font-mono"
            placeholder="felpa-gesu&#10;https://dreambrothers.it/products/..."
            value={form.products}
            onChange={(e) => setForm((f) => ({ ...f, products: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Reference TikTok (uno per riga)</Label>
          <Textarea
            rows={4}
            className="text-xs font-mono"
            placeholder="https://www.tiktok.com/@creator/video/..."
            value={form.referenceUrls}
            onChange={(e) => setForm((f) => ({ ...f, referenceUrls: e.target.value }))}
          />
          <p className="text-[11px] text-muted-foreground">
            Si prendono struttura, ritmo e angolo. <strong>Mai le parole</strong> — copiare il testo è plagio.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Note di brand per il montaggio</Label>
          <Textarea
            rows={3}
            className="text-xs"
            placeholder="Font e colore sottotitoli, tono, cosa non fare mai…"
            value={form.brandNotes}
            onChange={(e) => setForm((f) => ({ ...f, brandNotes: e.target.value }))}
          />
        </div>

        <Button
          onClick={() => salva.mutate(form)}
          disabled={salva.isPending}
          style={{ background: "var(--gradient-primary)" }}
        >
          <Save className="w-4 h-4 mr-2" />
          {salva.isPending ? "Salvo…" : "Salva configurazione"}
        </Button>
      </Card>

      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Wand2 className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Nessun video va in campagna da solo: l'agente consegna in <strong>Creative</strong> come bozza,
          e da lì approvi tu.
        </span>
      </div>
    </div>
  );
}
