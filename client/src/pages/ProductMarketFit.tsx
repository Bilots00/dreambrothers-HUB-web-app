import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const TYPE_LABEL: Record<string, string> = {
  NEW_PRODUCT: "Nuovo", PRICE_CHANGE: "Prezzo", STOCK_OUT: "Esaurito",
  RESTOCK: "Restock", REMOVED_PRODUCT: "Rimosso", COLLECTION_CHANGE: "Collezione",
};

export default function ProductMarketFit() {
  const utils = trpc.useUtils();
  const stores = trpc.marketIntel.listStores.useQuery();
  const changes = trpc.marketIntel.listChanges.useQuery({ hours: 168, limit: 200 });
  const brief = trpc.marketIntel.brief.useQuery({ hours: 168 });
  const addStore = trpc.marketIntel.addStore.useMutation({ onSuccess: () => utils.marketIntel.listStores.invalidate() });
  const runNow = trpc.marketIntel.runNow.useMutation({
    onSuccess: () => { utils.marketIntel.listChanges.invalidate(); utils.marketIntel.listStores.invalidate(); utils.marketIntel.brief.invalidate(); },
  });
  const removeStore = trpc.marketIntel.removeStore.useMutation({ onSuccess: () => utils.marketIntel.listStores.invalidate() });
  const [label, setLabel] = useState("");
  const [domain, setDomain] = useState("");

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Brief opportunità */}
      <div className="rounded-2xl p-5" style={{ background: "oklch(0.14 0.02 300)", border: "1px solid oklch(0.24 0.03 300)" }}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold" style={{ color: "oklch(0.8 0.15 310)" }}>Brief opportunità (7gg)</h2>
          <Button size="sm" disabled={runNow.isPending} onClick={() => runNow.mutate({})}>
            {runNow.isPending ? "Scansione…" : "Aggiorna ora"}
          </Button>
        </div>
        <pre className="text-xs whitespace-pre-wrap text-muted-foreground">{brief.data?.brief ?? "…"}</pre>
      </div>

      {/* Store competitor */}
      <div className="rounded-2xl p-5" style={{ background: "oklch(0.12 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
        <h2 className="text-sm font-semibold mb-3">Store competitor</h2>
        <div className="flex gap-2 mb-3">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Etichetta"
            className="px-3 py-2 rounded-lg text-sm flex-1" style={{ background: "oklch(0.16 0.02 260)", border: "1px solid oklch(0.24 0.02 260)" }} />
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="dominio-store.com"
            className="px-3 py-2 rounded-lg text-sm flex-1" style={{ background: "oklch(0.16 0.02 260)", border: "1px solid oklch(0.24 0.02 260)" }} />
          <Button disabled={addStore.isPending || !domain} onClick={() => { addStore.mutate({ label: label || domain, domain }); setLabel(""); setDomain(""); }}>Aggiungi</Button>
        </div>
        <div className="space-y-1">
          {(stores.data ?? []).map((s) => (
            <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ background: "oklch(0.15 0.015 260)" }}>
              <span>{s.label} <span className="text-muted-foreground">· {s.domain}</span> {!s.isShopify && <Badge className="ml-2">non-Shopify</Badge>}</span>
              <span className="flex items-center gap-2">
                <Badge>{s.status}</Badge>
                <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => runNow.mutate({ id: s.id })}>run</button>
                <button className="text-xs text-red-400 hover:text-red-300" onClick={() => removeStore.mutate({ id: s.id })}>×</button>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Cambiamenti */}
      <div className="rounded-2xl p-5" style={{ background: "oklch(0.12 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
        <h2 className="text-sm font-semibold mb-3">Cambiamenti rilevati</h2>
        <div className="space-y-1">
          {(changes.data ?? []).map((c) => (
            <a key={c.id} href={c.url ?? "#"} target="_blank" rel="noreferrer"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-accent" style={{ background: "oklch(0.15 0.015 260)" }}>
              <Badge>{TYPE_LABEL[c.changeType] ?? c.changeType}</Badge>
              {c.score != null && <Badge style={{ background: "oklch(0.6 0.2 300)" }}>{c.score}</Badge>}
              <span className="flex-1 truncate">{c.title}</span>
              <span className="text-muted-foreground text-xs">{c.oldValue}{c.newValue ? " → " + c.newValue : ""}</span>
            </a>
          ))}
          {changes.data?.length === 0 && <div className="text-xs text-muted-foreground">Nessun cambiamento. Aggiungi uno store e premi "Aggiorna ora".</div>}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Monitor basato solo su dati pubblici Shopify (products.json, collezioni, ordinamento best-seller) con polling
        conservativo. Le stime di vendita sono etichettate con metodo e confidenza; dove non misurabili pubblicamente
        (es. store POD) il tool lo dichiara invece di inventare numeri. L'utente è responsabile della conformità ai
        Termini di Servizio di ciascuno store monitorato.
      </p>
    </div>
  );
}
