import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  LayoutGrid, Lightbulb, Landmark, Search, TrendingUp, SlidersHorizontal,
  Heart, Download, ExternalLink, Sparkles, Plus, Trash2, RefreshCw,
  ChevronRight, Play, Loader2, CircleDot,
} from "lucide-react";
import { toast } from "sonner";

type TabId = "templates" | "inspiration" | "brands";
type FormatId = "ads" | "emails" | "landers";

const inputStyle = { background: "oklch(0.16 0.015 260)", border: "1px solid oklch(0.25 0.02 260)" };
const cardStyle = { background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.22 0.02 260)" };

const CATEGORIES = ["All", "Wall Art / Decor", "Clothing / Apparel", "DTC", "Beauty", "Consumer Goods", "Fitness / Wellness"];

// I media della Ads Library stanno su fbcdn.net, che blocca l'hotlinking
// cross-origin: vanno serviti dal proxy server (/api/img), come per la Watchlist.
function proxied(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("data:")) return url;
  if (/fbcdn\.net|cdninstagram\.com/.test(url)) return `/api/img?url=${encodeURIComponent(url)}`;
  return url;
}

/** Logo dell'advertiser con fallback alle iniziali se manca o non carica. */
function BrandLogo({ name, logoUrl, size = 40, radius = 12 }: { name: string; logoUrl?: string | null; size?: number; radius?: number }) {
  const [broken, setBroken] = useState(false);
  const src = proxied(logoUrl);
  if (src && !broken) {
    return (
      <img src={src} alt={name} referrerPolicy="no-referrer" loading="lazy"
        onError={() => setBroken(true)}
        className="object-cover shrink-0"
        style={{ width: size, height: size, borderRadius: radius, background: "oklch(0.22 0.02 260)" }} />
    );
  }
  return (
    <div className="flex items-center justify-center font-bold text-white shrink-0"
      style={{ width: size, height: size, borderRadius: radius, fontSize: size * 0.3, background: "oklch(0.22 0.02 260)" }}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

// ─── Card creative (masonry) con overlay stile CreativeOS ─────────────────────
function CreativeCard({ insp, onLike, onClone }: {
  insp: {
    id: number; pageName: string | null; title: string | null; bodyText: string | null;
    imageUrl: string | null; videoUrl: string | null; thumbnailUrl: string | null;
    landingUrl: string | null; activeDays: number; score: number; liked: boolean;
  };
  onLike: (id: number) => void;
  onClone: (id: number) => void;
}) {
  const media = insp.thumbnailUrl ?? insp.imageUrl;
  const [mediaBroken, setMediaBroken] = useState(false);
  return (
    <div className="mb-4 break-inside-avoid">
      <div className="group relative rounded-2xl overflow-hidden" style={cardStyle}>
        {media && !mediaBroken ? (
          <img src={proxied(media)} alt={insp.title ?? insp.pageName ?? "ad"} loading="lazy" referrerPolicy="no-referrer"
            onError={() => setMediaBroken(true)}
            className="w-full h-auto block" style={{ minHeight: 120 }} />
        ) : (
          <div className="w-full flex items-center justify-center p-8 text-xs text-muted-foreground" style={{ minHeight: 160 }}>
            {insp.title ?? insp.bodyText?.slice(0, 120) ?? "Creative"}
          </div>
        )}
        {insp.videoUrl && (
          <span className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: "oklch(0 0 0 / 0.55)" }}>
            <Play className="h-3 w-3" /> VIDEO
          </span>
        )}
        {/* Overlay in hover */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col"
          style={{ background: "oklch(0 0 0 / 0.45)" }}>
          <div className="flex justify-end gap-2 p-3">
            <button title={insp.liked ? "Rimuovi dai Templates" : "Salva nei Templates"}
              onClick={() => onLike(insp.id)}
              className="h-8 w-8 rounded-full flex items-center justify-center transition-transform hover:scale-110"
              style={{ background: "oklch(0.14 0.015 260 / 0.9)" }}>
              <Heart className="h-4 w-4" style={insp.liked ? { fill: "oklch(0.63 0.24 350)", color: "oklch(0.63 0.24 350)" } : { color: "white" }} />
            </button>
            {media && (
              <a href={insp.videoUrl ?? media} target="_blank" rel="noreferrer" title="Apri media"
                className="h-8 w-8 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                style={{ background: "oklch(0.14 0.015 260 / 0.9)" }}>
                <Download className="h-4 w-4 text-white" />
              </a>
            )}
            {insp.landingUrl && (
              <a href={insp.landingUrl} target="_blank" rel="noreferrer" title="Apri landing"
                className="h-8 w-8 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                style={{ background: "oklch(0.14 0.015 260 / 0.9)" }}>
                <ExternalLink className="h-4 w-4 text-white" />
              </a>
            )}
          </div>
          <div className="flex-1 flex items-center justify-center">
            <Button className="gap-2 font-semibold rounded-full px-5" style={{ background: "oklch(0.55 0.2 250)" }}
              onClick={() => onClone(insp.id)}>
              <Sparkles className="h-4 w-4" /> Clone Ad
            </Button>
          </div>
          {insp.pageName && (
            <div className="p-3 text-xs text-white/90 font-medium truncate">{insp.pageName}</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 px-1 pt-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Heart className="h-3 w-3" style={insp.liked ? { fill: "oklch(0.63 0.24 350)", color: "oklch(0.63 0.24 350)" } : undefined} />{insp.liked ? 1 : 0}</span>
        <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" />{insp.score}</span>
        <span className="ml-auto">{insp.activeDays}gg live</span>
      </div>
    </div>
  );
}

// ─── Pagina ───────────────────────────────────────────────────────────────────
export default function MetaInspiration() {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<TabId>("inspiration");
  const [q, setQ] = useState("");
  const [format, setFormat] = useState<FormatId>("ads");
  const [sort, setSort] = useState<"trending" | "newest">("trending");
  const [brandFilter, setBrandFilter] = useState<number | null>(null);
  const [category, setCategory] = useState("All");
  const [brandQ, setBrandQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newBrand, setNewBrand] = useState({ name: "", pageInput: "", category: "" });
  const [cloneTarget, setCloneTarget] = useState<number | null>(null);
  const [cloneNote, setCloneNote] = useState("");

  const inspirations = trpc.adsLibrary.inspirations.useQuery({
    q: q || undefined,
    brandId: brandFilter ?? undefined,
    liked: tab === "templates" ? true : undefined,
    format: format === "ads" ? undefined : format,
    sort,
  }, { enabled: tab !== "brands", refetchInterval: 60000 });
  const brands = trpc.adsLibrary.brands.useQuery(undefined, { refetchInterval: 60000 });

  const likeMut = trpc.adsLibrary.toggleLike.useMutation({
    onSuccess: (r) => { utils.adsLibrary.inspirations.invalidate(); toast.success(r.liked ? "Salvata nei Templates 🩷" : "Rimossa dai Templates"); },
    onError: (e) => toast.error(e.message),
  });
  const cloneMut = trpc.adsLibrary.clone.useMutation({
    onSuccess: () => { setCloneTarget(null); setCloneNote(""); toast.success("Inviata al Creative Director: la versione on-brand arriverà nelle Bozze"); },
    onError: (e) => toast.error(e.message),
  });
  const addBrandMut = trpc.adsLibrary.addBrand.useMutation({
    onSuccess: (r) => {
      utils.adsLibrary.brands.invalidate();
      setAddOpen(false); setNewBrand({ name: "", pageInput: "", category: "" });
      toast.success(r.alreadyExists ? "Brand già in watchlist" : "Brand aggiunto: scraping in corso…");
    },
    onError: (e) => toast.error(e.message),
  });
  const removeBrandMut = trpc.adsLibrary.removeBrand.useMutation({
    onSuccess: () => { utils.adsLibrary.brands.invalidate(); utils.adsLibrary.inspirations.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const refreshMut = trpc.adsLibrary.refreshBrand.useMutation({
    onSuccess: () => { utils.adsLibrary.brands.invalidate(); utils.adsLibrary.inspirations.invalidate(); toast.success("Refresh avviato"); },
    onError: (e) => toast.error(e.message),
  });

  const brandById = useMemo(() => new Map((brands.data ?? []).map((b) => [b.id, b])), [brands.data]);
  const filteredBrands = useMemo(() => {
    let list = brands.data ?? [];
    if (brandQ) list = list.filter((b) => b.name.toLowerCase().includes(brandQ.toLowerCase()));
    if (category !== "All") list = list.filter((b) => (b.category ?? "") === category);
    return list;
  }, [brands.data, brandQ, category]);
  const trendingBrands = useMemo(() => [...(brands.data ?? [])].sort((a, b) => b.adCount - a.adCount).slice(0, 3), [brands.data]);

  const openBrandLibrary = (brandId: number) => { setBrandFilter(brandId); setTab("inspiration"); };

  const TABS: Array<{ id: TabId; label: string; icon: React.ElementType }> = [
    { id: "templates", label: "Templates", icon: LayoutGrid },
    { id: "inspiration", label: "Inspiration", icon: Lightbulb },
    { id: "brands", label: "Brands", icon: Landmark },
  ];

  return (
    <div className="space-y-5">
      {/* Header: breadcrumb + Brand DNA */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Templates <span className="mx-1">›</span> <span className="text-foreground">{TABS.find((t) => t.id === tab)?.label}</span></p>
          <p className="text-sm text-muted-foreground mt-0.5">Discover winning creative</p>
        </div>
        <span className="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium"
          style={{ border: "1px solid oklch(0.55 0.2 250 / 0.5)", color: "oklch(0.7 0.15 250)" }}>
          <CircleDot className="h-3.5 w-3.5" /> Brand DNA Active
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "oklch(0.55 0.2 250)" }} />
        </span>
      </div>

      {/* Tab pills */}
      <div className="inline-flex items-center gap-1 rounded-xl p-1" style={cardStyle}>
        {TABS.map((t) => (
          <button key={t.id}
            onClick={() => { setTab(t.id); if (t.id === "brands") setBrandFilter(null); }}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={tab === t.id ? { background: "oklch(0.22 0.02 260)", color: "white" } : { color: "oklch(0.65 0.02 260)" }}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab !== "brands" ? (
        <>
          {/* Barra ricerca + filtri (stile CreativeOS) */}
          <div className="flex items-center gap-3 rounded-2xl p-3" style={cardStyle}>
            <div className="flex-1 flex items-center gap-2 px-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search inspiration..."
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground" />
            </div>
            <div className="inline-flex items-center gap-1 rounded-lg p-1" style={{ background: "oklch(0.18 0.015 260)" }}>
              {(["ads", "emails", "landers"] as FormatId[]).map((f) => (
                <button key={f} onClick={() => setFormat(f)}
                  className="rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors"
                  style={format === f ? { background: "oklch(0.24 0.02 260)", color: "white" } : { color: "oklch(0.6 0.02 260)" }}>
                  {f}
                </button>
              ))}
            </div>
            <button onClick={() => setSort(sort === "trending" ? "newest" : "trending")}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ background: "oklch(0.18 0.015 260)" }}>
              <TrendingUp className="h-3.5 w-3.5" /> {sort === "trending" ? "Trending" : "Newest"}
            </button>
            <button className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ background: "oklch(0.18 0.015 260)" }} onClick={() => { setQ(""); setBrandFilter(null); }}>
              <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
            </button>
          </div>

          {brandFilter != null && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Library: <span className="text-foreground font-medium">{brandById.get(brandFilter)?.name}</span></span>
              <button className="underline" onClick={() => setBrandFilter(null)}>rimuovi filtro</button>
            </div>
          )}

          {/* Griglia masonry */}
          {inspirations.isLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton-shimmer rounded-2xl" style={{ height: 220 + (i % 3) * 60 }} />)}
            </div>
          ) : (inspirations.data?.length ?? 0) === 0 ? (
            <div className="card-premium rounded-2xl p-12 text-center">
              {tab === "templates" ? (
                <>
                  <Heart className="h-12 w-12 mx-auto opacity-30 mb-3" />
                  <p className="text-sm text-muted-foreground">Nessuna creative salvata: metti il 🩷 alle ads vincenti nel feed Inspiration e le ritroverai qui come templates.</p>
                </>
              ) : (
                <>
                  <Lightbulb className="h-12 w-12 mx-auto opacity-30 mb-3" />
                  <p className="text-sm text-muted-foreground">Il feed è vuoto: aggiungi i brand da monitorare nella tab <b>Brands</b> e l'agente scraperà le loro ads migliori dalla Facebook Ads Library.</p>
                  <Button className="mt-4 gap-2" style={{ background: "var(--gradient-primary)" }} onClick={() => setTab("brands")}>
                    <Landmark className="h-4 w-4" /> Vai a Brands
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div style={{ columns: "4 240px", columnGap: "1rem" }}>
              {inspirations.data!.map((insp) => (
                <CreativeCard key={insp.id} insp={insp}
                  onLike={(id) => likeMut.mutate({ id })}
                  onClone={(id) => setCloneTarget(id)} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Brand Library (watchlist ad account) */}
          <div>
            <h2 className="text-2xl font-bold text-foreground">Brand Library</h2>
            <p className="text-sm text-muted-foreground mt-1">Explore creative libraries from top DTC brands — la tua watchlist della Facebook Ads Library</p>
          </div>
          <div className="rounded-2xl p-4 space-y-3" style={cardStyle}>
            <div className="flex items-center gap-2 px-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={brandQ} onChange={(e) => setBrandQ(e.target.value)} placeholder="Search brands..."
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground py-1.5" />
              <Button size="sm" className="gap-1.5" style={{ background: "var(--gradient-primary)" }} onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Aggiungi Brand
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={refreshMut.isPending}
                onClick={() => refreshMut.mutate({})}>
                {refreshMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh all
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setCategory(c)}
                  className="rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors"
                  style={category === c ? { background: "oklch(0.55 0.2 250)", color: "white" } : { background: "oklch(0.18 0.015 260)", color: "oklch(0.65 0.02 260)" }}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          {trendingBrands.length > 0 && (
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold mb-3"><TrendingUp className="h-4 w-4" style={{ color: "oklch(0.65 0.2 265)" }} /> Trending Brands</h3>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {trendingBrands.map((b) => (
                  <div key={b.id} className="rounded-2xl overflow-hidden" style={cardStyle}>
                    <div className="h-20 flex items-center px-4 gap-3" style={{ background: "linear-gradient(135deg, oklch(0.3 0.08 285), oklch(0.2 0.04 260))" }}>
                      <BrandLogo name={b.name} logoUrl={b.logoUrl} size={44} />
                      <div>
                        <p className="font-semibold text-white">{b.name}</p>
                        <p className="text-xs text-white/70">{b.adCount} assets</p>
                      </div>
                    </div>
                    <div className="p-4 space-y-2">
                      <p className="text-xs text-muted-foreground">Facebook Page ID: {b.pageId}</p>
                      <div className="flex items-center justify-between">
                        <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: "oklch(0.18 0.015 260)" }}>{b.adCount} templates</span>
                        <button className="flex items-center gap-1 text-sm" style={{ color: "oklch(0.65 0.2 265)" }} onClick={() => openBrandLibrary(b.id)}>
                          View Library <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-base font-semibold mb-3">All Brands</h3>
            {(brands.data?.length ?? 0) === 0 ? (
              <div className="card-premium rounded-2xl p-12 text-center">
                <Landmark className="h-12 w-12 mx-auto opacity-30 mb-3" />
                <p className="text-sm text-muted-foreground">Nessun brand in watchlist. Aggiungi il primo: cerca il brand nella <a className="underline" href="https://www.facebook.com/ads/library/" target="_blank" rel="noreferrer">Facebook Ads Library</a>, apri la sua pagina e incolla qui l'URL.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {filteredBrands.map((b) => (
                  <div key={b.id} className="group rounded-2xl p-4 flex items-center gap-3 cursor-pointer transition-colors hover:bg-accent/40" style={cardStyle}
                    onClick={() => openBrandLibrary(b.id)}>
                    <BrandLogo name={b.name} logoUrl={b.logoUrl} size={40} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{b.name}</p>
                      <p className="text-xs text-muted-foreground">{b.adCount} templates{b.status === "error" ? " · ⚠︎ errore" : b.status === "pending" ? " · in coda" : ""}</p>
                      {b.category && <span className="inline-block mt-1 rounded-full px-2 py-0.5 text-[10px]" style={{ background: "oklch(0.18 0.015 260)" }}>{b.category}</span>}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button title="Refresh" className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-accent"
                        onClick={(e) => { e.stopPropagation(); refreshMut.mutate({ id: b.id }); }}>
                        <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      <button title="Rimuovi" className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-accent"
                        onClick={(e) => { e.stopPropagation(); removeBrandMut.mutate({ id: b.id }); }}>
                        <Trash2 className="h-3.5 w-3.5" style={{ color: "oklch(0.55 0.22 25)" }} />
                      </button>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Dialog aggiungi brand */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg" style={{ background: "oklch(0.14 0.015 260)" }}>
          <DialogHeader><DialogTitle>Aggiungi un brand alla watchlist</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Nome brand</label>
              <Input style={inputStyle} value={newBrand.name} onChange={(e) => setNewBrand({ ...newBrand, name: e.target.value })} placeholder="Es. iKonick" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">URL Ads Library o Page ID</label>
              <Input style={inputStyle} value={newBrand.pageInput} onChange={(e) => setNewBrand({ ...newBrand, pageInput: e.target.value })}
                placeholder="https://www.facebook.com/ads/library/?...view_all_page_id=1234567890" />
              <p className="text-[11px] text-muted-foreground mt-1">Cerca il brand su <a className="underline" href="https://www.facebook.com/ads/library/" target="_blank" rel="noreferrer">facebook.com/ads/library</a>, apri le sue ads e copia l'URL (contiene <code>view_all_page_id</code>).</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Categoria (opzionale)</label>
              <Input style={inputStyle} value={newBrand.category} onChange={(e) => setNewBrand({ ...newBrand, category: e.target.value })} placeholder="Es. Wall Art / Decor" />
            </div>
            <Button className="w-full gap-2 font-semibold" style={{ background: "var(--gradient-primary)" }}
              disabled={addBrandMut.isPending || !newBrand.name.trim() || !newBrand.pageInput.trim()}
              onClick={() => addBrandMut.mutate({ name: newBrand.name, pageInput: newBrand.pageInput, category: newBrand.category || undefined })}>
              {addBrandMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Aggiungi e scrapa
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog clone */}
      <Dialog open={cloneTarget != null} onOpenChange={(o) => !o && setCloneTarget(null)}>
        <DialogContent className="max-w-lg" style={{ background: "oklch(0.14 0.015 260)" }}>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" style={{ color: "oklch(0.65 0.2 265)" }} /> Clone Ad — versione on-brand</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">La creative verrà inviata al <b>Creative Director</b> come reference: genererà una variante adattata a DreamBrothers (brand voice, lessico dreamer, no false claims) e la salverà nelle <b>Bozze</b>.</p>
          <Textarea style={inputStyle} rows={3} value={cloneNote} onChange={(e) => setCloneNote(e.target.value)}
            placeholder='Note opzionali (es. "adattala al poster Dream Big, angle: identity cue mattutino")' />
          <Button className="w-full gap-2 font-semibold" style={{ background: "var(--gradient-primary)" }}
            disabled={cloneMut.isPending}
            onClick={() => cloneTarget != null && cloneMut.mutate({ id: cloneTarget, note: cloneNote || undefined })}>
            {cloneMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Invia al Creative Director
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
