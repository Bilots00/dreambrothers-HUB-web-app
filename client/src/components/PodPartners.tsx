import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, CheckCircle, Package, Award, Globe, Truck } from "lucide-react";
import { toast } from "sonner";

const SMISTAMENTO_URL =
  (import.meta as any).env?.VITE_SMISTAMENTO_URL ||
  "https://smistamento-ordini.andrea-bilotta00.workers.dev";
const CONFIG_SECRET = (import.meta as any).env?.VITE_SMISTAMENTO_CONFIG_KEY || "";

type PodConfig = { certEnabled: boolean; updatedAt?: string };

export function PodPartners() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<PodConfig>({ certEnabled: true });

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${SMISTAMENTO_URL}/config`);
        if (r.ok) {
          const data = await r.json();
          if (typeof data.certEnabled === "boolean") setConfig(data);
        }
      } catch (e) {} finally { setLoading(false); }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${SMISTAMENTO_URL}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CONFIG-KEY": CONFIG_SECRET },
        body: JSON.stringify({ certEnabled: config.certEnabled }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      toast.success("Impostazioni salvate", { description: "Il routing degli ordini è aggiornato." });
    } catch (e: any) {
      toast.error("Errore salvataggio", { description: e?.message || "Riprova" });
    } finally { setSaving(false); }
  };

  const euSupplier = config.certEnabled ? "Prodigi" : "Printumo";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Package className="h-6 w-6 text-primary" />
        <h2 className="text-xl font-semibold">POD Partners (suppliers)</h2>
      </div>
      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Award className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <div className="font-medium">Certificato di Autenticità (insert dinamico)</div>
                <p className="text-sm text-muted-foreground max-w-xl">
                  Quando è ATTIVO, per l'Europa gli ordini che Gelato non può produrre vengono
                  instradati a <strong>Prodigi</strong> (insert personalizzato per ordine).
                  Quando è DISATTIVO, si usa <strong>Printumo</strong> (nessun certificato).
                </p>
              </div>
            </div>
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Switch checked={config.certEnabled}
                onCheckedChange={(v) => setConfig((c) => ({ ...c, certEnabled: v }))} />
            )}
          </div>
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Routing attivo</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <RouteCard icon={<Globe className="h-4 w-4" />} region="Europa / Resto del mondo" supplier={euSupplier} cert={config.certEnabled} />
              <RouteCard icon={<Truck className="h-4 w-4" />} region="Stati Uniti" supplier="LumaPrints" cert={config.certEnabled} />
              <RouteCard icon={<CheckCircle className="h-4 w-4" />} region="Formati coperti da Gelato" supplier="Gelato (nativa)" cert={true} note="Poster nei formati Gelato — sempre con certificato" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Fornitore EU per prodotti non-Gelato: <Badge variant="secondary">{euSupplier}</Badge>
            </div>
            <Button onClick={save} disabled={saving || loading}>
              {saving ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvataggio…</>) : "Salva impostazioni"}
            </Button>
          </div>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Nota: prima di usare Prodigi abilita la componente postcard in dashboard.prodigi.com/settings/branding.
        Gli SKU Prodigi vanno mappati nel worker (tabella PRODIGI_SKU).
      </p>
    </div>
  );
}

function RouteCard(props: { icon: React.ReactNode; region: string; supplier: string; cert: boolean; note?: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center gap-2 text-sm font-medium">{props.icon}{props.region}</div>
      <div className="mt-1 text-sm">{props.supplier}</div>
      <div className="mt-2">
        <Badge variant={props.cert ? "default" : "outline"} className="text-[10px]">
          {props.cert ? "✓ Certificato incluso" : "senza certificato"}
        </Badge>
      </div>
      {props.note && <div className="mt-2 text-[11px] text-muted-foreground">{props.note}</div>}
    </div>
  );
}
