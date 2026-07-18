import { useMemo, useState, type ElementType } from "react";
import {
  Radar, Youtube, Instagram, Music2, RefreshCw, Trash2, Plus, ExternalLink,
  Download, Bot, Eye, Heart, MessageCircle, Zap, AlertTriangle, CheckCircle2,
  LayoutGrid, Sparkles, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const PLATFORMS: Record<string, { label: string; icon: ElementType; color: string }> = {
  youtube: { label: "YouTube", icon: Youtube, color: "oklch(0.6 0.22 25)" },
  instagram: { label: "Instagram", icon: Instagram, color: "oklch(0.65 0.2 340)" },
  tiktok: { label: "TikTok", icon: Music2, color: "oklch(0.75 0.15 195)" },
};

// IG/TikTok bloccano l'hotlinking cross-origin: instrada le loro immagini dal
// proxy server (/api/img). YouTube (i.ytimg.com) e i data-URI passano diretti.
function proxied(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("data:")) return url;
  if (/(^|\.)ytimg\.com|googleusercontent\.com|ggpht\.com/.test(url)) return url;
  if (/cdninstagram\.com|fbcdn\.net|tiktokcdn|ttwstatic\.com/.test(url)) {
    return `/api/img?url=${encodeURIComponent(url)}`;
  }
  return url;
}

const nf = new Intl.NumberFormat("it-IT", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number | null | undefined) => (n != null && n > 0 ? nf.format(n) : "—");
const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short" }) : "—";

function outlierStyle(score: number | null): { bg: string; fg: string } {
  if (score == null) return { bg: "oklch(0.2 0.02 260)", fg: "oklch(0.7 0.02 260)" };
  if (score >= 2) return { bg: "oklch(0.55 0.18 150 / 0.25)", fg: "oklch(0.8 0.18 150)" };
  if (score >= 1) return { bg: "oklch(0.55 0.15 150 / 0.15)", fg: "oklch(0.75 0.13 150)" };
  return { bg: "oklch(0.2 0.02 260)", fg: "oklch(0.6 0.02 260)" };
}

export default function SocialWatchlist() {
  const utils = trpc.useUtils();
  const channels = trpc.watchlist.list.useQuery(undefined, { refetchInterval: 30000 });
  const apifyBudget = trpc.watchlist.apifyBudget.useQuery(undefined, { refetchInterval: 60000 });

  const [tab, setTab] = useState<"feed" | "templates">("feed");
  const [filterChannel, setFilterChannel] = useState<string>("all");
  const [filterPlatform, setFilterPlatform] = useState<string>("all");
  const [lookback, setLookback] = useState<string>("30");
  const [minOutlier, setMinOutlier] = useState<string>("0");
  const [sort, setSort] = useState<"outlier" | "views" | "recent">("outlier");
  const [remixTarget, setRemixTarget] = useState<number | null>(null);
  const [remixNote, setRemixNote] = useState("");

  const isTemplates = tab === "templates";
  const videosInput = {
    channelId: filterChannel !== "all" ? Number(filterChannel) : undefined,
    platform: filterPlatform !== "all" ? (filterPlatform as "youtube" | "instagram" | "tiktok") : undefined,
    // nei Templates conta ciò che hai salvato, non la finestra temporale
    lookbackDays: isTemplates ? 0 : Number(lookback),
    minOutlier: isTemplates ? 0 : Number(minOutlier),
    liked: isTemplates ? true : undefined,
    sort,
    limit: 100,
  };
  const videos = trpc.watchlist.videos.useQuery(videosInput, { refetchInterval: 60000 });

  const likeMut = trpc.watchlist.toggleLike.useMutation({
    onSuccess: (r) => {
      utils.watchlist.videos.invalidate();
      toast.success(r.liked ? "Salvato nei Templates 🩷" : "Rimosso dai Templates");
    },
    onError: (e) => toast.error(e.message),
  });
  const remixMut = trpc.watchlist.requestRemix.useMutation({
    onSuccess: () => {
      setRemixTarget(null); setRemixNote("");
      toast.success("Inviato all'AI Manager: la versione on-brand arriverà nelle Bozze");
    },
    onError: (e) => toast.error(e.message),
  });

  const invalidate = () => {
    utils.watchlist.list.invalidate();
    utils.watchlist.videos.invalidate();
  };

  const [newInput, setNewInput] = useState("");
  const [newPlatform, setNewPlatform] = useState<string>("auto");
  const add = trpc.watchlist.add.useMutation({
    onSuccess: (r) => {
      invalidate();
      setNewInput("");
      if (r.refresh.ok) toast.success(`@${r.handle} aggiunto — ${r.refresh.videosStored} video importati`);
      else toast.warning(`@${r.handle} aggiunto, ma il primo fetch è fallito: ${r.refresh.error}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.watchlist.remove.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const refresh = trpc.watchlist.refresh.useMutation({
    onSuccess: (r) => {
      invalidate();
      if ("refreshed" in r) {
        const errs = r.errors.length ? ` — errori: ${r.errors.map((e) => e.handle).join(", ")}` : "";
        toast.success(`${r.refreshed} canali aggiornati${errs}`);
      } else if (r.ok) toast.success(`Canale aggiornato — ${r.videosStored} video`);
      else toast.error(`Refresh fallito: ${r.error}`);
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => setRefreshingId(null),
  });
  const requestAnalysis = trpc.watchlist.requestAnalysis.useMutation({
    onSuccess: () => toast.success("Richiesta inviata all'AI Manager — troverai l'analisi in chat"),
    onError: (e) => toast.error(e.message),
  });

  const handleAdd = () => {
    if (!newInput.trim()) return;
    add.mutate({
      input: newInput.trim(),
      platform: newPlatform !== "auto" ? (newPlatform as "youtube" | "instagram" | "tiktok") : undefined,
    });
  };

  const list = channels.data ?? [];
  const feed = videos.data ?? [];

  const exportCsv = () => {
    if (feed.length === 0) { toast.warning("Nessun video da esportare con i filtri attuali"); return; }
    const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["canale", "piattaforma", "titolo", "url", "pubblicato", "views", "likes", "commenti", "condivisioni", "engagement", "outlier_score"].join(","),
      ...feed.map((v) => [
        esc(v.channelHandle), esc(v.platform), esc(v.title), esc(v.url),
        esc(v.publishedAt ? new Date(v.publishedAt).toISOString().slice(0, 10) : ""),
        v.views, v.likes, v.comments, v.shares,
        v.engagementRate ?? "", v.outlierScore ?? "",
      ].join(",")),
    ];
    const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `watchlist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const totalViews30d = useMemo(() => list.reduce((s, c) => s + (c.views30d ?? 0), 0), [list]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl p-6 flex items-center gap-4" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
          <Radar className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Watchlist</h1>
          <p className="text-sm text-muted-foreground">Monitora canali competitor su YouTube, Instagram e TikTok — outlier score, feed e analisi AI. Gratis, senza Sandcastles.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {apifyBudget.data && (
            <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl"
              title={`Apify (piano free $5/mese): stima $${apifyBudget.data.spentUsd} / $${apifyBudget.data.capUsd}. Al limite, IG/TikTok/Pinterest si mettono in pausa fino al mese nuovo.`}
              style={{
                background: apifyBudget.data.blocked ? "oklch(0.6 0.2 30 / 0.15)" : "oklch(0.6 0.15 150 / 0.12)",
                border: `1px solid ${apifyBudget.data.blocked ? "oklch(0.6 0.2 30 / 0.4)" : "oklch(0.6 0.15 150 / 0.3)"}`,
                color: apifyBudget.data.blocked ? "oklch(0.7 0.18 30)" : "oklch(0.75 0.14 150)",
              }}>
              Apify ${apifyBudget.data.spentUsd}/${apifyBudget.data.capUsd}{apifyBudget.data.blocked ? " · limite" : ""}
            </div>
          )}
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl" style={{ background: "oklch(0.65 0.2 265 / 0.12)", border: "1px solid oklch(0.65 0.2 265 / 0.3)", color: "oklch(0.75 0.15 265)" }}>
            <Radar className="w-3.5 h-3.5" /> {list.length} canali · {fmtNum(totalViews30d)} views 30g
          </div>
        </div>
      </div>

      {/* Tab pills: Feed (tutti i contenuti) / Templates (i salvati col 🩷) */}
      <div className="inline-flex items-center gap-1 rounded-xl p-1" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.22 0.02 260)" }}>
        {([
          { id: "feed" as const, label: "Feed", icon: Radar },
          { id: "templates" as const, label: "Templates", icon: LayoutGrid },
        ]).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={tab === t.id ? { background: "oklch(0.22 0.02 260)", color: "white" } : { color: "oklch(0.65 0.02 260)" }}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
        {/* ── Feed video ── */}
        <div className="space-y-4">
          {/* Filtri */}
          <div className="rounded-2xl p-3 flex flex-wrap items-center gap-2" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
            <Select value={filterChannel} onValueChange={setFilterChannel}>
              <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Canale" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i canali</SelectItem>
                {list.map((c) => <SelectItem key={c.id} value={String(c.id)}>@{c.handle}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterPlatform} onValueChange={setFilterPlatform}>
              <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Piattaforma" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte</SelectItem>
                <SelectItem value="youtube">YouTube</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="tiktok">TikTok</SelectItem>
              </SelectContent>
            </Select>
            <Select value={lookback} onValueChange={setLookback}>
              <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Periodo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Ultimi 7 giorni</SelectItem>
                <SelectItem value="30">Ultimi 30 giorni</SelectItem>
                <SelectItem value="90">Ultimi 90 giorni</SelectItem>
                <SelectItem value="365">Ultimo anno</SelectItem>
                <SelectItem value="0">Sempre</SelectItem>
              </SelectContent>
            </Select>
            <Select value={minOutlier} onValueChange={setMinOutlier}>
              <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Outlier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Tutti i video</SelectItem>
                <SelectItem value="1">Solo outlier ≥ 1x</SelectItem>
                <SelectItem value="2">Solo outlier ≥ 2x</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Ordina" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="outlier">Per outlier score</SelectItem>
                <SelectItem value="views">Per views</SelectItem>
                <SelectItem value="recent">Più recenti</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs ml-auto" onClick={exportCsv}>
              <Download className="w-3.5 h-3.5 mr-1" />Export CSV
            </Button>
          </div>

          {/* Empty state */}
          {feed.length === 0 && (
            <div className="rounded-2xl p-10 text-center text-sm text-muted-foreground" style={{ background: "oklch(0.13 0.015 260)", border: "1px dashed oklch(0.22 0.015 260)" }}>
              {isTemplates
                ? <>Nessun contenuto salvato: metti il 🩷 ai video vincenti nel <b>Feed</b> e li ritroverai qui, pronti da remixare.</>
                : list.length === 0
                ? <>Aggiungi il primo canale alla watchlist (URL o @handle) e importo subito i suoi video. 📡</>
                : <>Nessun video con questi filtri. Prova ad allargare il periodo o abbassare la soglia outlier.</>}
            </div>
          )}

          {/* Cards video */}
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {feed.map((v) => {
              const p = PLATFORMS[v.platform] ?? PLATFORMS.youtube;
              const Icon = p.icon;
              const score = v.outlierScore != null ? parseFloat(String(v.outlierScore)) : null;
              const os = outlierStyle(score);
              const eng = v.engagementRate != null ? `${(parseFloat(String(v.engagementRate)) * 100).toFixed(1)}%` : null;
              // fallback: la thumbnail canonica YouTube esiste sempre, anche se il fetch non l'ha trovata
              const rawThumb = v.thumbnailUrl ?? (v.platform === "youtube" ? `https://i.ytimg.com/vi/${v.platformVideoId}/hqdefault.jpg` : null);
              const thumbSrc = proxied(rawThumb);
              return (
                <div key={v.id} className="group rounded-2xl overflow-hidden flex flex-col" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
                  <div className="relative block aspect-video" style={{ background: "oklch(0.1 0.01 260)" }}>
                    <a href={v.url} target="_blank" rel="noreferrer" className="block w-full h-full">
                      {thumbSrc && (
                        <img src={thumbSrc} alt={v.title ?? ""} loading="lazy" referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            const canonical = v.platform === "youtube" ? `https://i.ytimg.com/vi/${v.platformVideoId}/hqdefault.jpg` : null;
                            if (canonical && !img.src.includes("ytimg.com")) img.src = canonical;
                            else img.style.display = "none";
                          }} />
                      )}
                    </a>
                    <span className="absolute top-2 left-2 flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full pointer-events-none" style={{ background: os.bg, color: os.fg, backdropFilter: "blur(4px)" }}>
                      <Zap className="w-3 h-3" />{score != null ? `${score}x` : "n/d"}
                    </span>
                    <span className="absolute top-2 right-2 rounded-lg flex items-center justify-center pointer-events-none" style={{ width: 24, height: 24, background: `${p.color}33`, backdropFilter: "blur(4px)" }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: p.color }} />
                    </span>

                    {/* Overlay hover: 🩷 salva nei Templates + Remix on-brand */}
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col"
                      style={{ background: "oklch(0 0 0 / 0.45)" }}>
                      <div className="flex justify-end gap-2 p-2">
                        <button title={v.liked ? "Rimuovi dai Templates" : "Salva nei Templates"}
                          onClick={() => likeMut.mutate({ id: v.id })}
                          className="h-8 w-8 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                          style={{ background: "oklch(0.14 0.015 260 / 0.9)" }}>
                          <Heart className="h-4 w-4" style={v.liked ? { fill: "oklch(0.63 0.24 350)", color: "oklch(0.63 0.24 350)" } : { color: "white" }} />
                        </button>
                        <a href={v.url} target="_blank" rel="noreferrer" title="Apri contenuto"
                          className="h-8 w-8 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                          style={{ background: "oklch(0.14 0.015 260 / 0.9)" }}>
                          <ExternalLink className="h-4 w-4 text-white" />
                        </a>
                      </div>
                      <div className="flex-1 flex items-center justify-center">
                        <Button className="gap-2 font-semibold rounded-full px-5" style={{ background: "oklch(0.6 0.2 300)" }}
                          onClick={() => setRemixTarget(v.id)}>
                          <Sparkles className="h-4 w-4" /> Remix
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 flex flex-col flex-1">
                    <h3 className="text-sm font-semibold line-clamp-2 mb-1">{v.title || "(senza titolo)"}</h3>
                    <p className="text-xs text-muted-foreground mb-2">@{v.channelHandle} · {fmtDate(v.publishedAt)}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-auto">
                      <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{fmtNum(v.views)}</span>
                      <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{fmtNum(v.likes)}</span>
                      <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />{fmtNum(v.comments)}</span>
                      {eng && <span className="ml-auto">{eng} eng.</span>}
                    </div>
                    <div className="flex gap-2 mt-3 pt-3 items-center" style={{ borderTop: "1px solid oklch(0.2 0.015 260)" }}>
                      {v.analyzedAt ? (
                        <span className="flex items-center gap-1 text-xs" style={{ color: "oklch(0.75 0.13 150)" }}><CheckCircle2 className="w-3.5 h-3.5" />Analizzato</span>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={requestAnalysis.isPending}
                          onClick={() => requestAnalysis.mutate({ url: v.url, title: v.title ?? undefined })}>
                          <Bot className="w-3.5 h-3.5 mr-1" />Analizza
                        </Button>
                      )}
                      <a href={v.url} target="_blank" rel="noreferrer" className="ml-auto">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"><ExternalLink className="w-3.5 h-3.5 mr-1" />Apri</Button>
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Sidebar: La tua Watchlist ── */}
        <div className="rounded-2xl p-4 space-y-3 lg:sticky lg:top-4" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
          <h2 className="text-sm font-semibold">La tua Watchlist</h2>

          {/* Aggiungi canale */}
          <div className="space-y-2">
            <input
              value={newInput}
              onChange={(e) => setNewInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              placeholder="URL canale o @handle"
              className="w-full text-sm rounded-lg px-3 py-2 bg-transparent text-foreground"
              style={{ border: "1px solid oklch(0.22 0.015 260)" }}
            />
            <div className="flex gap-2">
              <Select value={newPlatform} onValueChange={setNewPlatform}>
                <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (da URL)</SelectItem>
                  <SelectItem value="youtube">YouTube</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8 text-white px-3" style={{ background: "var(--gradient-primary)" }} disabled={add.isPending || !newInput.trim()} onClick={handleAdd}>
                {add.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>

          {/* Lista canali */}
          <div className="space-y-1.5">
            {list.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">Nessun canale ancora.</p>}
            {list.map((c) => {
              const p = PLATFORMS[c.platform] ?? PLATFORMS.youtube;
              const Icon = p.icon;
              return (
                <div key={c.id} className="flex items-center gap-2.5 rounded-xl px-2 py-2 group" style={{ background: "oklch(0.16 0.015 260)" }}>
                  <div className="relative shrink-0">
                    {c.avatarUrl ? (
                      <img src={proxied(c.avatarUrl)} alt={c.handle} referrerPolicy="no-referrer" className="w-9 h-9 rounded-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: `${p.color}22`, color: p.color }}>
                        {c.handle.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <span className="absolute -bottom-0.5 -right-0.5 rounded-full flex items-center justify-center" style={{ width: 15, height: 15, background: "oklch(0.14 0.015 260)" }}>
                      <Icon className="w-2.5 h-2.5" style={{ color: p.color }} />
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <p className="text-xs font-semibold truncate">@{c.handle}</p>
                      {c.status === "error" && (
                        <span title={c.lastError ?? "Errore refresh"}><AlertTriangle className="w-3 h-3 shrink-0" style={{ color: "oklch(0.7 0.15 60)" }} /></span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {fmtNum(c.followers)} follower · {fmtNum(c.views30d)} views 30g
                    </p>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={refresh.isPending}
                      onClick={() => { setRefreshingId(c.id); refresh.mutate({ id: c.id }); }}>
                      <RefreshCw className={`w-3.5 h-3.5 ${refreshingId === c.id ? "animate-spin" : ""}`} />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400" disabled={remove.isPending}
                      onClick={() => remove.mutate({ id: c.id })}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {list.length > 0 && (
            <div className="flex gap-2 pt-2" style={{ borderTop: "1px solid oklch(0.2 0.015 260)" }}>
              <Button size="sm" variant="ghost" className="h-8 text-xs flex-1" disabled={refresh.isPending}
                onClick={() => { setRefreshingId(-1); refresh.mutate({}); }}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${refreshingId === -1 ? "animate-spin" : ""}`} />Aggiorna tutti
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs flex-1" onClick={exportCsv}>
                <Download className="w-3.5 h-3.5 mr-1" />Export
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Dialog remix */}
      <Dialog open={remixTarget != null} onOpenChange={(o) => !o && setRemixTarget(null)}>
        <DialogContent className="max-w-lg" style={{ background: "oklch(0.14 0.015 260)" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" style={{ color: "oklch(0.6 0.2 300)" }} /> Remix — versione on-brand
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Il contenuto verrà mandato all'<b>AI Manager</b> come reference: manterrà il formato che lo fa funzionare
            (hook, ritmo, struttura) ma con la voce DreamBrothers, e lo salverà nelle <b>Bozze</b>. Organic ≠ selling: nessun pitch.
          </p>
          <Textarea rows={3} value={remixNote} onChange={(e) => setRemixNote(e.target.value)}
            style={{ background: "oklch(0.16 0.015 260)", border: "1px solid oklch(0.25 0.02 260)" }}
            placeholder='Note opzionali (es. "adattalo al poster Dream Big, angle: la routine del mattino")' />
          <Button className="w-full gap-2 font-semibold text-white" style={{ background: "linear-gradient(135deg, oklch(0.6 0.2 300), oklch(0.55 0.2 320))" }}
            disabled={remixMut.isPending}
            onClick={() => remixTarget != null && remixMut.mutate({ id: remixTarget, note: remixNote || undefined })}>
            {remixMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Invia all'AI Manager
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
