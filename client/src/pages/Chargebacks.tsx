import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useState } from "react";
import {
  AlertTriangle, CheckCircle, ExternalLink, Landmark, RefreshCw, ShieldAlert, Timer, XCircle,
} from "lucide-react";

/**
 * Chargeback Shopify.
 *
 * La pagina e' costruita attorno a UN numero: i giorni che restano per
 * rispondere. Passata quella data Shopify risponde da solo con quello che
 * trova e la contestazione e' persa senza averla giocata — quindi la scadenza
 * viene prima dell'importo, del cliente e di tutto il resto.
 */

const SHOP_ADMIN = "https://admin.shopify.com/store/dream-brothers-home";

const statoShopify: Record<string, { label: string; color: string }> = {
  needs_response: { label: "Da rispondere", color: "oklch(0.55 0.22 25)" },
  under_review: { label: "In esame dalla banca", color: "oklch(0.72 0.18 75)" },
  won: { label: "Vinto", color: "oklch(0.65 0.18 145)" },
  lost: { label: "Perso", color: "oklch(0.5 0.02 260)" },
  accepted: { label: "Accettato", color: "oklch(0.5 0.02 260)" },
};

const statoNostro: Record<string, { label: string; color: string }> = {
  nuovo: { label: "Da prendere in mano", color: "oklch(0.55 0.22 25)" },
  in_lavorazione: { label: "In lavorazione", color: "oklch(0.72 0.18 75)" },
  risolto: { label: "Chiuso da noi", color: "oklch(0.65 0.18 145)" },
};

/** I motivi che la banca comunica, in italiano comprensibile. */
const motivi: Record<string, string> = {
  product_not_received: "Prodotto mai ricevuto",
  product_unacceptable: "Prodotto non conforme",
  fraudulent: "Transazione non riconosciuta (frode)",
  duplicate: "Addebito doppio",
  subscription_canceled: "Abbonamento annullato",
  unrecognized: "Addebito non riconosciuto",
  credit_not_processed: "Rimborso non accreditato",
  customer_initiated: "Aperta dal cliente",
  general: "Generico",
  incorrect_account_details: "Dati di pagamento errati",
  insufficient_funds: "Fondi insufficienti",
  bank_cannot_process: "La banca non ha potuto processare",
  debit_not_authorized: "Addebito non autorizzato",
};

function Countdown({ giorni, data }: { giorni: number | null; data: string | null }) {
  if (giorni === null || !data) {
    return <span className="text-xs text-muted-foreground">scadenza non comunicata da Shopify</span>;
  }
  // Sotto i 4 giorni il colore diventa rosso: e' il punto in cui non c'e' piu'
  // tempo per una risposta del cliente e bisogna decidere da soli.
  const colore = giorni < 0 ? "oklch(0.5 0.02 260)" : giorni <= 3 ? "oklch(0.55 0.22 25)" : giorni <= 7 ? "oklch(0.72 0.18 75)" : "oklch(0.65 0.18 145)";
  const quando = new Date(data).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
  return (
    <div className="flex items-center gap-2">
      <Timer className="w-3.5 h-3.5" style={{ color: colore }} />
      <span className="text-sm font-semibold" style={{ color: colore }}>
        {giorni < 0
          ? `Termine scaduto (${quando})`
          : giorni === 0
            ? `Ultimo giorno: OGGI`
            : `${giorni} giorn${giorni === 1 ? "o" : "i"} per rispondere`}
      </span>
      {giorni >= 0 && <span className="text-xs text-muted-foreground">— entro il {quando}</span>}
    </div>
  );
}

export default function Chargebacks() {
  const utils = trpc.useUtils();
  const { data: righe, isLoading } = trpc.chargebacks.list.useQuery(undefined, { refetchInterval: 60000 });
  const [noteAperte, setNoteAperte] = useState<Record<number, string>>({});

  const sync = trpc.chargebacks.sync.useMutation({
    onSuccess: (r) => {
      utils.chargebacks.list.invalidate();
      utils.chargebacks.conteggio.invalidate();
      if (r.errori.length) toast.error(`Sincronizzato con errori: ${r.errori[0]}`);
      else toast.success(`Sincronizzato: ${r.trovati} contestazioni (${r.nuovi} nuove)`);
    },
    onError: (e) => toast.error(e.message),
  });

  const aggiorna = trpc.chargebacks.aggiorna.useMutation({
    onSuccess: () => {
      utils.chargebacks.list.invalidate();
      utils.chargebacks.conteggio.invalidate();
      toast.success("Aggiornato");
    },
    onError: (e) => toast.error(e.message),
  });

  const markSeen = trpc.chargebacks.markSeen.useMutation({
    onSuccess: () => {
      utils.chargebacks.list.invalidate();
      utils.chargebacks.conteggio.invalidate();
    },
  });

  const tutte = righe ?? [];
  const aperte = tutte.filter((c) => c.aperto);
  const chiuse = tutte.filter((c) => !c.aperto);
  const nonViste = tutte.filter((c) => !c.visto).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Chargeback</h2>
          <p className="text-sm text-muted-foreground">
            Contestazioni bancarie sugli ordini Shopify — con il tempo che resta per rispondere
          </p>
        </div>
        <div className="flex items-center gap-2">
          {nonViste > 0 && (
            <Button variant="outline" size="sm" onClick={() => markSeen.mutate()}>
              Segna visti ({nonViste})
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-2" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={`w-3.5 h-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
            Sincronizza
          </Button>
        </div>
      </div>

      {/* Perche' questa pagina esiste */}
      <div className="rounded-2xl p-4" style={{ background: "oklch(0.65 0.2 265 / 0.07)", border: "1px solid oklch(0.65 0.2 265 / 0.2)" }}>
        <div className="flex gap-3">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "oklch(0.7 0.15 265)" }} />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Shopify annuncia i chargeback <strong>solo via email all'indirizzo proprietario dello store</strong> e
            l'app mobile non manda nessuna push: e' cosi' che il caso #1261 e' rimasto invisibile per giorni.
            Da qui le contestazioni arrivano per due strade indipendenti — il webhook <code>disputes/*</code> in
            tempo reale e un controllo automatico ogni 20 minuti come rete di sicurezza.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-32 rounded-xl skeleton-shimmer" />)}</div>
      ) : tutte.length === 0 ? (
        <div className="card-premium rounded-2xl p-12 text-center">
          <CheckCircle className="w-12 h-12 mx-auto mb-4" style={{ color: "oklch(0.65 0.18 145)", opacity: 0.5 }} />
          <h3 className="font-semibold text-foreground mb-2">Nessuna contestazione</h3>
          <p className="text-sm text-muted-foreground">
            Nessun chargeback aperto sullo store. Il controllo automatico gira ogni 20 minuti.
          </p>
        </div>
      ) : (
        <>
          {aperte.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" style={{ color: "oklch(0.65 0.22 35)" }} />
                Aperte ({aperte.length})
              </h3>
              {aperte.map((c) => {
                const sh = statoShopify[c.status] ?? statoShopify.needs_response;
                const nos = statoNostro[c.nostroStato] ?? statoNostro.nuovo;
                const urgente = c.giorniRimasti !== null && c.giorniRimasti <= 3;
                return (
                  <div
                    key={c.id}
                    className="rounded-2xl p-4"
                    style={{
                      background: urgente ? "oklch(0.55 0.22 25 / 0.07)" : "oklch(0.14 0.015 260)",
                      border: `1px solid ${urgente ? "oklch(0.55 0.22 25 / 0.35)" : "oklch(0.22 0.015 260)"}`,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${sh.color}20` }}>
                        <Landmark style={{ width: 18, height: 18, color: sh.color }} />
                      </div>

                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">Ordine {c.orderName || "?"}</span>
                          {c.amount && (
                            <span className="text-sm font-semibold" style={{ color: sh.color }}>
                              {c.amount} {c.currency}
                            </span>
                          )}
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: `${sh.color}20`, color: sh.color }}>
                            {sh.label}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: `${nos.color}20`, color: nos.color }}>
                            {nos.label}
                          </span>
                          {c.tipo === "inquiry" && (
                            <span className="text-xs text-muted-foreground">(richiesta di informazioni, non ancora addebito)</span>
                          )}
                          {!c.visto && <div className="w-2 h-2 rounded-full" style={{ background: "oklch(0.55 0.22 25)" }} />}
                        </div>

                        <Countdown giorni={c.giorniRimasti} data={c.evidenceDueBy} />

                        <div className="text-xs text-muted-foreground space-y-0.5">
                          {c.customerName && (
                            <div>
                              Cliente: <span className="text-foreground">{c.customerName}</span>
                              {c.customerEmail && ` — ${c.customerEmail}`}
                            </div>
                          )}
                          <div>
                            Motivo della banca:{" "}
                            <span className="text-foreground">{c.reason ? (motivi[c.reason] ?? c.reason) : "non comunicato"}</span>
                          </div>
                        </div>

                        {/* Note operative: cosa abbiamo gia' fatto su questo caso.
                            Senza, fra due settimane nessuno ricorda se il cliente
                            ha risposto o se il fornitore ha aperto il claim. */}
                        <textarea
                          className="w-full text-xs rounded-lg p-2 bg-transparent"
                          style={{ border: "1px solid oklch(0.24 0.015 260)", minHeight: 54 }}
                          placeholder="Cosa abbiamo fatto: contattato il cliente, claim al fornitore, prove caricate..."
                          value={noteAperte[c.id] ?? c.note}
                          onChange={(e) => setNoteAperte((s) => ({ ...s, [c.id]: e.target.value }))}
                          onBlur={(e) => {
                            if (e.target.value !== c.note) aggiorna.mutate({ id: c.id, note: e.target.value });
                          }}
                        />

                        <div className="flex items-center gap-2 flex-wrap pt-1">
                          <a
                            href={`${SHOP_ADMIN}/orders/${c.orderId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                            style={{ border: "1px solid oklch(0.24 0.015 260)" }}
                          >
                            <ExternalLink className="w-3 h-3" />
                            Apri su Shopify
                          </a>
                          {c.customerEmail && (
                            <a
                              href={`mailto:${c.customerEmail}?subject=${encodeURIComponent(`Your DreamBrothers order ${c.orderName}`)}`}
                              className="text-xs flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                              style={{ border: "1px solid oklch(0.24 0.015 260)" }}
                            >
                              Scrivi al cliente
                            </a>
                          )}
                          {c.nostroStato !== "in_lavorazione" && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => aggiorna.mutate({ id: c.id, nostroStato: "in_lavorazione" })}>
                              Presa in mano
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => aggiorna.mutate({ id: c.id, nostroStato: "risolto" })}>
                            <CheckCircle className="w-3 h-3" />
                            Chiudi
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {chiuse.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">Chiuse ({chiuse.length})</h3>
              {chiuse.map((c) => {
                const sh = statoShopify[c.status] ?? statoShopify.lost;
                return (
                  <div key={c.id} className="rounded-xl p-3 flex items-center gap-3 opacity-60" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.22 0.015 260)" }}>
                    {c.status === "won" ? (
                      <CheckCircle className="w-4 h-4 shrink-0" style={{ color: "oklch(0.65 0.18 145)" }} />
                    ) : (
                      <XCircle className="w-4 h-4 shrink-0" style={{ color: "oklch(0.5 0.02 260)" }} />
                    )}
                    <span className="text-sm text-foreground">{c.orderName}</span>
                    {c.amount && <span className="text-xs text-muted-foreground">{c.amount} {c.currency}</span>}
                    <span className="text-xs ml-auto" style={{ color: sh.color }}>{sh.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
