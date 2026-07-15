import { useMemo, useState } from "react";
import {
  Newspaper, RefreshCw, ExternalLink, Sparkles, Settings2, Search,
  Trash2, Bookmark, FileText, X as XIcon, TrendingUp, MessageSquare, Mail, Rss,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const SOURCE_META: Record<string, { label: string; color: string; icon: typeof Rss }> = {
  reddit: { label: "Reddit", color: "oklch(0.65 0.2 35)", icon: MessageSquare },
  news: { label: "News", color: "oklch(0.65 0.18 250)", icon: Newspaper },
  trends: { label: "Trends", color: "oklch(0.7 0.16 150)", icon: TrendingUp },
  substack: { label: "Substack", color: "oklch(0.7 0.17 60)", icon: Rss },
  gmail: { label: "Gmail", color: "oklch(0.62 0.2 25)", icon: Mail },
  manual: { label: "Manuale", color: "oklch(0.6 0.02 260)", icon: FileText },
};

const STATUS_LABEL: Record<string, string> = {
  da_leggere: "Da leggere", salvato: "Salvato", usato: "Usato", cestinato: "Cestinato",
};

function scoreColor(score: number | null | undefined): { bg: string; fg: string } {
  if (score == null) return { bg: "oklch(0.2 0.02 260)", fg: "oklch(0.55 0.02 260)" };
  if (score >= 8) return { bg: "oklch(0.55 0.18 150 / 0.25)", fg: "oklch(0.8 0.18 150)" };
  if (score >= 6) return { bg: "oklch(0.6 0.15 90 / 0.2)", fg: "oklch(0.8 0.14 90)" };
  return { bg: "oklch(0.2 0.02 260)", fg: "oklch(0.65 0.02 260)" };
}

function ScoreChip({ label, value }: { label: string; value: number | null | undefined }) {
  const c = scoreColor(value);
  return (
    <span className="inline-flex flex-col items-center rounded-lg px-2 py-1" style={{ background: c.bg, minWidth: 42 }}>
      <span className="text-sm font-bold leading-none" style={{ color: c.fg }}>{value ?? "—"}</span>
      <span className="text-[9px] uppercase tracking-wider mt-0.5" style={{ color: "oklch(0.55 0.02 260)" }}>{label}</span>
    </span>
  );
}

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function SeoResearch() {
  const utils = trpc.useUtils();

  const [hours, setHours] = useState("48");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [minVirality, setMinVirality] = useState("0");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  const listInput = {
    hours: Number(hours),
    source: source !== "all" ? source : undefined,
    status: status !== "all" ? (status as "da_leggere" | "salvato" | "usato" | "cestinato") : undefined,
    minVirality: Number(minVirality),
    search: search.trim() || undefined,
    limit: 150,
  };
  const items = trpc.research.list.useQuery(listInput, { refetchInterval: 120000 });
  const config = trpc.research.getConfig.useQuery(undefined, { enabled: showConfig });

  const invalidate = () => utils.research.list.invalidate();

  const refresh = trpc.research.refresh.useMutation({
    onSuccess: (r) => {
      invalidate();
      const errs = r.errors.length ? ` · ${r.errors.length} fonti in errore` : "";
      toast.success(`${r.stored} nuovi item (${r.fetched} letti, ${r.enriched} analizzati dall'AI)${errs}`);
      if (r.errors.length) console.warn("[research] errori fonti:", r.errors);
    },
    onError: (e) => toast.error(e.message),
  });
  const setItemStatus = trpc.research.setStatus.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const enrich = trpc.research.enrichPending.useMutation({
    onSuccess: (r) => { invalidate(); toast.success(`${r.enriched} item analizzati dall'AI`); },
    onError: (e) => toast.error(e.message),
  });
  const generate = trpc.research.generateContent.useMutation({
    onSuccess: (r) => {
      invalidate();
      if (r.ok) toast.success("Brief inviato all'AI Manager — le bozze (blog + X + Facebook) arriveranno in Bozze");
      else toast.error(r.error ?? "Errore");
    },
    onError: (e) => toast.error(e.message),
  });
  const saveConfig = trpc.research.saveConfig.useMutation({
    onSuccess: () => { toast.success("Configurazione salvata"); setShowConfig(false); utils.research.getConfig.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const list = items.data ?? [];
  const openItem = useMemo(() => list.find((i) => i.id === openId) ?? null, [list, openId]);

  const [cfgForm, setCfgForm] = useState<{ subreddits: string; newsQueries: string; substacks: string; trendsGeo: string; brandContext: string } | null>(null);
  const cfgReady = config.data && !cfgForm && showConfig;
  if (cfgReady) {
    setCfgForm({
      subreddits: config.data!.sources.subreddits.join("\n"),
      newsQueries: config.data!.sources.newsQueries.join("\n"),
      substacks: config.data!.sources.substacks.join("\n"),
      trendsGeo: config.data!.sources.trendsGeo,
      brandContext: config.data!.brandContext,
    });
  }
  const splitLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl p-6 flex items-center gap-4" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
          <Newspaper className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Research Hub</h1>
          <p className="text-sm text-muted-foreground">Trend, news e conversazioni di mercato → articoli blog SEO, post X e Facebook. Sempre con la chiave di lettura del brand, mai rumore.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setShowConfig(true)}>
            <Settings2 className="w-4 h-4 mr-1" />Fonti
          </Button>
          <Button size="sm" variant="ghost" className="h-9" disabled={enrich.isPending} onClick={() => enrich.mutate()}>
            <Sparkles className={`w-4 h-4 mr-1 ${enrich.isPending ? "animate-pulse" : ""}`} />Analizza AI
          </Button>
          <Button size="sm" className="h-9 text-white" style={{ background: "var(--gradient-primary)" }} disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            <RefreshCw className={`w-4 h-4 mr-1 ${refresh.isPending ? "animate-spin" : ""}`} />{refresh.isPending ? "Scansione..." : "Aggiorna feed"}
          </Button>
        </div>
      </div>

      {/* Filtri */}
      <div className="rounded-2xl p-3 flex flex-wrap items-center gap-2" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca per titolo..."
            className="h-8 w-[200px] text-xs rounded-lg pl-8 pr-3 bg-transparent text-foreground" style={{ border: "1px solid oklch(0.22 0.015 260)" }} />
        </div>
        <Select value={hours} onValueChange={setHours}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="24">Ultime 24 ore</SelectItem>
            <SelectItem value="48">Ultime 48 ore</SelectItem>
            <SelectItem value="168">Ultima settimana</SelectItem>
            <SelectItem value="0">Tutti</SelectItem>
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Fonte" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutte le fonti</SelectItem>
            {Object.entries(SOURCE_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Stato" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Attivi (no cestino)</SelectItem>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={minVirality} onValueChange={setMinVirality}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Ogni viralità</SelectItem>
            <SelectItem value="7">Virali (7+)</SelectItem>
            <SelectItem value="9">Top virali (9+)</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground px-2">{list.length} contenuti</span>
      </div>

      {/* Lista */}
      {list.length === 0 && (
        <div className="rounded-2xl p-10 text-center text-sm text-muted-foreground" style={{ background: "oklch(0.13 0.015 260)", border: "1px dashed oklch(0.22 0.015 260)" }}>
          Nessun contenuto. Premi <b>Aggiorna feed</b> per scansionare Reddit, Google News, Google Trends e Substack. 📡
        </div>
      )}
      <div className="space-y-2">
        {list.map((i) => {
          const sm = SOURCE_META[i.source] ?? SOURCE_META.manual;
          const Icon = sm.icon;
          return (
            <div key={i.id} className="rounded-xl px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors hover:brightness-110"
              style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}
              onClick={() => setOpenId(i.id)}>
              <span className="rounded-lg flex items-center justify-center shrink-0" style={{ width: 30, height: 30, background: `${sm.color}22`, border: `1px solid ${sm.color}44` }}>
                <Icon className="w-3.5 h-3.5" style={{ color: sm.color }} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{i.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {i.sourceDetail ?? sm.label} · {fmtDate(i.publishedAt ?? i.fetchedAt)}
                  {i.status !== "da_leggere" && <> · <span style={{ color: "oklch(0.75 0.15 265)" }}>{STATUS_LABEL[i.status]}</span></>}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <ScoreChip label="vir" value={i.viralityScore} />
                <ScoreChip label="targ" value={i.targetScore} />
                <ScoreChip label="int" value={i.interestScore} />
              </div>
              <div className="flex gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Salva"
                  onClick={() => setItemStatus.mutate({ id: i.id, status: "salvato" })}>
                  <Bookmark className="w-3.5 h-3.5" style={{ color: i.status === "salvato" ? "oklch(0.75 0.15 265)" : undefined }} />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-400" title="Cestina"
                  onClick={() => setItemStatus.mutate({ id: i.id, status: "cestinato" })}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal dettaglio */}
      {openItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "oklch(0 0 0 / 0.7)" }} onClick={() => setOpenId(null)}>
          <div className="rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 space-y-4"
            style={{ background: "oklch(0.15 0.015 260)", border: "1px solid oklch(0.25 0.015 260)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-xs uppercase tracking-wider mb-1" style={{ color: (SOURCE_META[openItem.source] ?? SOURCE_META.manual).color }}>
                  {(SOURCE_META[openItem.source] ?? SOURCE_META.manual).label}{openItem.sourceDetail ? ` · ${openItem.sourceDetail}` : ""}
                </p>
                <h2 className="text-lg font-bold leading-snug">{openItem.title}</h2>
                <p className="text-xs text-muted-foreground mt-1">Pubblicato: {fmtDate(openItem.publishedAt)} · Engagement: {openItem.engagement || "n/d"}</p>
              </div>
              <button className="p-1 text-muted-foreground hover:text-foreground" onClick={() => setOpenId(null)}><XIcon className="w-5 h-5" /></button>
            </div>

            <div className="flex gap-3">
              <ScoreChip label="viralità" value={openItem.viralityScore} />
              <ScoreChip label="in target" value={openItem.targetScore} />
              <ScoreChip label="interesse" value={openItem.interestScore} />
            </div>

            {openItem.brief && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "oklch(0.75 0.15 265)" }}>● Brief</p>
                <p className="text-sm whitespace-pre-line">{openItem.brief}</p>
              </div>
            )}
            {openItem.angle && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "oklch(0.8 0.18 150)" }}>● Chiave di lettura (brand)</p>
                <p className="text-sm whitespace-pre-line">{openItem.angle}</p>
              </div>
            )}
            {openItem.commentAnalysis && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: "oklch(0.7 0.16 60)" }}>● Analisi conversazione</p>
                <p className="text-sm whitespace-pre-line">{openItem.commentAnalysis}</p>
              </div>
            )}
            {openItem.excerpt && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1 text-muted-foreground">● Estratto</p>
                <p className="text-sm text-muted-foreground whitespace-pre-line line-clamp-[12]">{openItem.excerpt}</p>
              </div>
            )}
            {!openItem.enrichedAt && (
              <p className="text-xs text-muted-foreground italic">Brief e chiave di lettura non ancora generati — usa "Analizza AI" nella barra in alto.</p>
            )}

            <div className="flex flex-wrap gap-2 pt-3" style={{ borderTop: "1px solid oklch(0.22 0.015 260)" }}>
              <Button size="sm" className="h-9 text-white" style={{ background: "var(--gradient-primary)" }}
                disabled={generate.isPending}
                onClick={() => generate.mutate({ id: openItem.id, formats: ["blog", "x", "facebook"] })}>
                <Sparkles className="w-4 h-4 mr-1" />{generate.isPending ? "Invio..." : "Genera contenuti (blog + X + FB)"}
              </Button>
              <Button size="sm" variant="ghost" className="h-9"
                onClick={() => setItemStatus.mutate({ id: openItem.id, status: openItem.status === "salvato" ? "da_leggere" : "salvato" })}>
                <Bookmark className="w-4 h-4 mr-1" />{openItem.status === "salvato" ? "Rimuovi da salvati" : "Salva"}
              </Button>
              {openItem.url && (
                <a href={openItem.url} target="_blank" rel="noreferrer" className="ml-auto">
                  <Button size="sm" variant="ghost" className="h-9"><ExternalLink className="w-4 h-4 mr-1" />Apri fonte</Button>
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal configurazione fonti */}
      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "oklch(0 0 0 / 0.7)" }} onClick={() => { setShowConfig(false); setCfgForm(null); }}>
          <div className="rounded-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto p-6 space-y-4"
            style={{ background: "oklch(0.15 0.015 260)", border: "1px solid oklch(0.25 0.015 260)" }}
            onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">Fonti & contesto brand</h2>
            {!cfgForm ? (
              <p className="text-sm text-muted-foreground">Caricamento configurazione...</p>
            ) : (
              <>
                <div>
                  <p className="text-xs font-semibold mb-1">Subreddit (uno per riga, senza r/)</p>
                  <Textarea rows={4} value={cfgForm.subreddits} onChange={(e) => setCfgForm((f) => f && ({ ...f, subreddits: e.target.value }))}
                    className="text-sm" style={{ background: "oklch(0.16 0.015 260)", border: "1px solid oklch(0.22 0.015 260)" }} />
                </div>
                <div>
                  <p className="text-xs font-semibold mb-1">Query Google News (una per riga)</p>
                  <Textarea rows={3} value={cfgForm.newsQueries} onChange={(e) => setCfgForm((f) => f && ({ ...f, newsQueries: e.target.value }))}
                    className="text-sm" style={{ background: "oklch(0.16 0.015 260)", border: "1px solid oklch(0.22 0.015 260)" }} />
                </div>
                <div>
                  <p className="text-xs font-semibold mb-1">Substack (nome pubblicazione o dominio, uno per riga)</p>
                  <Textarea rows={2} value={cfgForm.substacks} onChange={(e) => setCfgForm((f) => f && ({ ...f, substacks: e.target.value }))}
                    className="text-sm" style={{ background: "oklch(0.16 0.015 260)", border: "1px solid oklch(0.22 0.015 260)" }} />
                </div>
                <div>
                  <p className="text-xs font-semibold mb-1">Geo Google Trends (es. IT, US)</p>
                  <input value={cfgForm.trendsGeo} onChange={(e) => setCfgForm((f) => f && ({ ...f, trendsGeo: e.target.value.toUpperCase().slice(0, 5) }))}
                    className="w-24 text-sm rounded-lg px-3 py-2 bg-transparent text-foreground" style={{ border: "1px solid oklch(0.22 0.015 260)" }} />
                </div>
                <div>
                  <p className="text-xs font-semibold mb-1">Contesto brand per i punteggi AI (buyer persona, valori, TOV)</p>
                  <Textarea rows={5} value={cfgForm.brandContext} onChange={(e) => setCfgForm((f) => f && ({ ...f, brandContext: e.target.value }))}
                    className="text-sm" style={{ background: "oklch(0.16 0.015 260)", border: "1px solid oklch(0.22 0.015 260)" }} />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" className="h-9 text-white" style={{ background: "var(--gradient-primary)" }} disabled={saveConfig.isPending}
                    onClick={() => saveConfig.mutate({
                      sources: {
                        subreddits: splitLines(cfgForm.subreddits),
                        newsQueries: splitLines(cfgForm.newsQueries),
                        substacks: splitLines(cfgForm.substacks),
                        trendsGeo: cfgForm.trendsGeo || "IT",
                      },
                      brandContext: cfgForm.brandContext,
                    })}>
                    Salva configurazione
                  </Button>
                  <Button size="sm" variant="ghost" className="h-9" onClick={() => { setShowConfig(false); setCfgForm(null); }}>Annulla</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
