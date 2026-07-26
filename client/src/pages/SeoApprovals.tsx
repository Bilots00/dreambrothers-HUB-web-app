import { useMemo, useState } from "react";
import {
  ShieldCheck, RefreshCw, Check, X as XIcon, AlertTriangle, Clock,
  ChevronDown, ChevronRight, Bot, User as UserIcon, ExternalLink, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Decisione = "in_attesa" | "approvata" | "approvata_con_condizioni" | "rifiutata";

const DEC_META: Record<Decisione, { label: string; fg: string; bg: string; icon: typeof Check }> = {
  in_attesa: { label: "Da decidere", fg: "oklch(0.82 0.15 90)", bg: "oklch(0.6 0.15 90 / 0.18)", icon: Clock },
  approvata: { label: "Approvata", fg: "oklch(0.8 0.18 150)", bg: "oklch(0.55 0.18 150 / 0.2)", icon: Check },
  approvata_con_condizioni: { label: "Con condizioni", fg: "oklch(0.78 0.16 250)", bg: "oklch(0.55 0.18 250 / 0.2)", icon: AlertTriangle },
  rifiutata: { label: "Rifiutata", fg: "oklch(0.75 0.19 25)", bg: "oklch(0.55 0.2 25 / 0.18)", icon: XIcon },
};

const CARD = { background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" };

const fmtDate = (d: string) =>
  d ? new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/* ------------------------------------------------------------------ */
/* Renderer markdown minimale. Tutto viene escapato prima: nessun HTML */
/* proveniente dalla proposta finisce mai nel DOM come markup.         */
/* ------------------------------------------------------------------ */

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded text-[0.85em]" style="background:oklch(0.2 0.02 260);color:oklch(0.85 0.1 150)">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:oklch(0.95 0.01 260)">$1</strong>');
}

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    const out: string[] = [];
    const lines = text.split(/\r?\n/);
    let inCode = false;
    let listOpen = false;
    const closeList = () => { if (listOpen) { out.push("</ul>"); listOpen = false; } };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      if (/^```/.test(line)) {
        closeList();
        out.push(inCode ? "</code></pre>" : '<pre class="rounded-lg p-3 my-2 overflow-x-auto text-xs" style="background:oklch(0.11 0.015 260);border:1px solid oklch(0.2 0.015 260)"><code>');
        inCode = !inCode;
        continue;
      }
      if (inCode) { out.push(esc(raw) + "\n"); continue; }

      if (!line.trim()) { closeList(); continue; }

      let m: RegExpExecArray | null;
      if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
        closeList();
        const lvl = m[1].length;
        const size = lvl <= 2 ? "text-base" : "text-sm";
        out.push(`<h${lvl} class="${size} font-bold mt-4 mb-1.5" style="color:oklch(0.95 0.01 260)">${inline(m[2])}</h${lvl}>`);
      } else if ((m = /^>\s?(.*)$/.exec(line))) {
        closeList();
        out.push(`<blockquote class="pl-3 my-2 text-xs italic" style="border-left:3px solid oklch(0.45 0.15 250);color:oklch(0.7 0.02 260)">${inline(m[1])}</blockquote>`);
      } else if ((m = /^[-*]\s+(.*)$/.exec(line))) {
        if (!listOpen) { out.push('<ul class="list-disc pl-5 space-y-1 my-1.5">'); listOpen = true; }
        out.push(`<li class="text-sm">${inline(m[1])}</li>`);
      } else if ((m = /^\d+\.\s+(.*)$/.exec(line))) {
        if (!listOpen) { out.push('<ul class="list-decimal pl-5 space-y-1 my-1.5">'); listOpen = true; }
        out.push(`<li class="text-sm">${inline(m[1])}</li>`);
      } else if (/^\|/.test(line)) {
        closeList();
        if (/^\|[\s:|-]+\|?$/.test(line)) continue; // riga separatrice
        const cells = line.split("|").slice(1, -1).map((c) => `<span class="pr-3">${inline(c.trim())}</span>`);
        out.push(`<div class="flex flex-wrap text-xs py-0.5" style="color:oklch(0.72 0.02 260)">${cells.join("")}</div>`);
      } else {
        closeList();
        out.push(`<p class="text-sm my-1.5" style="color:oklch(0.78 0.015 260)">${inline(line)}</p>`);
      }
    }
    closeList();
    if (inCode) out.push("</code></pre>");
    return out.join("");
  }, [text]);

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/* ------------------------------------------------------------------ */

function Badge({ decisione }: { decisione: Decisione }) {
  const m = DEC_META[decisione];
  const Icon = m.icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap"
      style={{ background: m.bg, color: m.fg }}>
      <Icon className="w-3 h-3" />{m.label}
    </span>
  );
}

export default function SeoApprovals() {
  const utils = trpc.useUtils();
  const [filtro, setFiltro] = useState<"da_decidere" | "tutte" | Decisione>("da_decidere");
  const [aperta, setAperta] = useState<string | null>(null);
  const [modo, setModo] = useState<Record<string, "condizioni" | "rifiuto" | null>>({});
  const [note, setNote] = useState<Record<string, string>>({});

  const proposte = trpc.seoApprovals.list.useQuery(undefined, { refetchInterval: 120000, retry: false });
  const backlog = trpc.seoApprovals.backlog.useQuery(undefined, { refetchInterval: 300000, retry: false });

  const decidi = trpc.seoApprovals.decidi.useMutation({
    onSuccess: (p) => {
      utils.seoApprovals.list.invalidate();
      utils.seoApprovals.backlog.invalidate();
      setModo((s) => ({ ...s, [p.path]: null }));
      setNote((s) => ({ ...s, [p.path]: "" }));
      setAperta(null);
      const t = DEC_META[p.decisione as Decisione].label.toLowerCase();
      toast.success(`Proposta ${t} — l'agente la legge al prossimo run (07:30)`, { duration: 7000 });
    },
    onError: (e) => toast.error(e.message, { duration: 12000 }),
  });

  const tutte = proposte.data ?? [];
  const lista = useMemo(() => {
    if (filtro === "tutte") return tutte;
    if (filtro === "da_decidere") return tutte.filter((p) => p.decisione === "in_attesa");
    return tutte.filter((p) => p.decisione === filtro);
  }, [tutte, filtro]);

  const daDecidere = tutte.filter((p) => p.decisione === "in_attesa").length;
  const b = backlog.data;
  const pct = b && b.totale > 0 ? Math.round((b.done / b.totale) * 100) : 0;

  const invia = (path: string, decisione: "approvata" | "approvata_con_condizioni" | "rifiutata", sha: string) => {
    const testo = (note[path] ?? "").trim();
    if (decisione !== "approvata" && testo.length < 10) {
      toast.error(decisione === "rifiutata"
        ? "Scrivi perché la rifiuti e cosa fare invece: senza motivo l'agente riproporrebbe la stessa cosa."
        : "Scrivi le condizioni da rispettare.");
      return;
    }
    decidi.mutate({ path, decisione, note: testo || undefined, sha });
  };

  const FILTRI: Array<[typeof filtro, string, number]> = [
    ["da_decidere", "Da decidere", daDecidere],
    ["approvata", "Approvate", tutte.filter((p) => p.decisione === "approvata").length],
    ["approvata_con_condizioni", "Con condizioni", tutte.filter((p) => p.decisione === "approvata_con_condizioni").length],
    ["rifiutata", "Rifiutate", tutte.filter((p) => p.decisione === "rifiutata").length],
    ["tutte", "Tutte", tutte.length],
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl p-6 flex flex-wrap items-center gap-4" style={CARD}>
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "var(--gradient-primary)" }}>
          <ShieldCheck className="w-6 h-6 text-white" />
        </div>
        <div className="min-w-[220px]">
          <h1 className="text-xl font-bold">Approvazioni SEO</h1>
          <p className="text-sm text-muted-foreground">
            Le proposte del SEO Architect. Un task al giorno dalla checklist GoldenWeb: qui decidi se applicarlo, a quali condizioni, o perché no.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {daDecidere > 0 && (
            <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: DEC_META.in_attesa.bg, color: DEC_META.in_attesa.fg }}>
              {daDecidere} in attesa
            </span>
          )}
          <Button size="sm" variant="ghost" className="h-9" disabled={proposte.isFetching}
            onClick={() => { utils.seoApprovals.list.invalidate(); utils.seoApprovals.backlog.invalidate(); }}>
            <RefreshCw className={`w-4 h-4 mr-1 ${proposte.isFetching ? "animate-spin" : ""}`} />Aggiorna
          </Button>
        </div>
      </div>

      {/* Avanzamento checklist */}
      {b && (
        <div className="rounded-2xl p-4" style={CARD}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Checklist GoldenWeb</span>
            <span className="text-xs text-muted-foreground">{b.done} di {b.totale} completati · {pct}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "oklch(0.2 0.02 260)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "var(--gradient-primary)" }} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-muted-foreground">
            <span>In coda: <b className="text-foreground">{b.pending}</b></span>
            <span>Proposti: <b className="text-foreground">{b.proposed}</b></span>
            <span>Aspettano te: <b className="text-foreground">{b.waitingAndrea}</b></span>
            <span>Bloccati: <b className="text-foreground">{b.blocked}</b></span>
            {b.failed > 0 && <span style={{ color: DEC_META.rifiutata.fg }}>Falliti: <b>{b.failed}</b></span>}
            {b.rejected > 0 && <span>Scartati: <b className="text-foreground">{b.rejected}</b></span>}
          </div>
        </div>
      )}

      {/* Filtri */}
      <div className="flex flex-wrap gap-2">
        {FILTRI.map(([k, label, n]) => (
          <button key={String(k)} onClick={() => setFiltro(k)}
            className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
            style={filtro === k
              ? { background: "var(--gradient-primary)", color: "white" }
              : { background: "oklch(0.16 0.015 260)", color: "oklch(0.7 0.02 260)", border: "1px solid oklch(0.22 0.015 260)" }}>
            {label} {n > 0 && <span className="opacity-70">({n})</span>}
          </button>
        ))}
      </div>

      {/* Errori / stati vuoti */}
      {proposte.isError && (
        <div className="rounded-2xl p-5 text-sm" style={{ ...CARD, borderColor: "oklch(0.4 0.15 25)" }}>
          <p className="font-semibold mb-1" style={{ color: DEC_META.rifiutata.fg }}>Non riesco a leggere le proposte</p>
          <p className="text-muted-foreground">{proposte.error.message}</p>
        </div>
      )}

      {proposte.isLoading && (
        <div className="rounded-2xl p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground" style={CARD}>
          <Loader2 className="w-4 h-4 animate-spin" />Carico le proposte…
        </div>
      )}

      {!proposte.isLoading && !proposte.isError && lista.length === 0 && (
        <div className="rounded-2xl p-8 text-center" style={CARD}>
          <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">{filtro === "da_decidere" ? "Niente da decidere" : "Nessuna proposta in questo filtro"}</p>
          <p className="text-xs text-muted-foreground mt-1">
            L'agente gira ogni giorno alle 07:30 e lascia qui la proposta del giorno.
          </p>
        </div>
      )}

      {/* Lista */}
      <div className="space-y-3">
        {lista.map((p) => {
          const isOpen = aperta === p.path;
          const m = modo[p.path] ?? null;
          const busy = decidi.isPending && decidi.variables?.path === p.path;
          return (
            <div key={p.path} className="rounded-2xl overflow-hidden" style={CARD}>
              <button className="w-full p-4 flex items-start gap-3 text-left" onClick={() => setAperta(isOpen ? null : p.path)}>
                {isOpen ? <ChevronDown className="w-4 h-4 mt-1 shrink-0 opacity-60" /> : <ChevronRight className="w-4 h-4 mt-1 shrink-0 opacity-60" />}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-mono font-bold" style={{ background: "oklch(0.2 0.02 260)", color: "oklch(0.7 0.02 260)" }}>
                      {p.taskId}
                    </span>
                    <Badge decisione={p.decisione as Decisione} />
                    {p.applicato && (
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase" style={{ background: "oklch(0.55 0.18 150 / 0.2)", color: "oklch(0.8 0.18 150)" }}>
                        applicata
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      {p.esecutore === "andrea" ? <UserIcon className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                      {p.esecutore === "andrea" ? "tocca a te" : "la fa l'agente"}
                    </span>
                  </div>
                  <p className="text-sm font-semibold leading-snug">{p.titolo}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {fmtDate(p.data)}{p.decisoIl ? ` · deciso il ${fmtDate(p.decisoIl)}` : ""}
                  </p>
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-4">
                  <div className="rounded-xl p-4 max-h-[55vh] overflow-y-auto" style={{ background: "oklch(0.11 0.015 260)", border: "1px solid oklch(0.18 0.015 260)" }}>
                    <Markdown text={p.corpo} />
                  </div>

                  {p.applicato ? (
                    <p className="text-xs text-muted-foreground">Già applicata dall'agente e verificata. Non è più modificabile.</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" className="h-9 text-white" style={{ background: "oklch(0.55 0.18 150)" }}
                          disabled={busy} onClick={() => invia(p.path, "approvata", p.sha)}>
                          <Check className="w-4 h-4 mr-1" />Approva
                        </Button>
                        <Button size="sm" variant="ghost" className="h-9"
                          style={m === "condizioni" ? { background: DEC_META.approvata_con_condizioni.bg, color: DEC_META.approvata_con_condizioni.fg } : undefined}
                          disabled={busy} onClick={() => setModo((s) => ({ ...s, [p.path]: m === "condizioni" ? null : "condizioni" }))}>
                          <AlertTriangle className="w-4 h-4 mr-1" />Approva con condizioni
                        </Button>
                        <Button size="sm" variant="ghost" className="h-9"
                          style={m === "rifiuto" ? { background: DEC_META.rifiutata.bg, color: DEC_META.rifiutata.fg } : undefined}
                          disabled={busy} onClick={() => setModo((s) => ({ ...s, [p.path]: m === "rifiuto" ? null : "rifiuto" }))}>
                          <XIcon className="w-4 h-4 mr-1" />Rifiuta
                        </Button>
                        {busy && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />Scrivo la decisione…</span>}
                      </div>

                      {m && (
                        <div className="space-y-2">
                          <label className="text-xs font-medium">
                            {m === "rifiuto"
                              ? "Perché non va bene, e cosa potrebbe fare invece"
                              : "A quali condizioni può applicarla"}
                          </label>
                          <Textarea
                            value={note[p.path] ?? ""}
                            onChange={(e) => setNote((s) => ({ ...s, [p.path]: e.target.value }))}
                            rows={5}
                            placeholder={m === "rifiuto"
                              ? "Es: non toccare il tema live in stagione alta. Proponi invece la stessa modifica su un tema duplicato, così la testo prima di pubblicarla."
                              : "Es: ok ma solo sulle collection in inglese, e i meta title restano sotto i 60 caratteri."}
                            className="text-sm"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            L'agente legge questo testo al prossimo run e ne tiene conto: {m === "rifiuto" ? "riproporrà una soluzione diversa, non la stessa." : "applicherà solo rispettando le condizioni."}
                          </p>
                          <Button size="sm" className="h-9 text-white" style={{ background: "var(--gradient-primary)" }}
                            disabled={busy}
                            onClick={() => invia(p.path, m === "rifiuto" ? "rifiutata" : "approvata_con_condizioni", p.sha)}>
                            Conferma decisione
                          </Button>
                        </div>
                      )}
                    </>
                  )}

                  <a href={`https://github.com/Bilots00/dreambrothers-seo-architect-AUTO/blob/main/${p.path}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                    <ExternalLink className="w-3 h-3" />Apri il file su GitHub
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
