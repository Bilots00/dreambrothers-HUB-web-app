import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Image as ImageIcon, Video, FolderOpen, Link2, Search,
  RefreshCw, ExternalLink, Send, Download, Filter,
  Sparkles, CheckCircle, AlertCircle, Grid3x3, List
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  size?: string;
  thumbnailLink?: string;
}

type ViewMode = "grid" | "list";
type FilterType = "all" | "image" | "video";

// ─── Google Drive helpers ─────────────────────────────────────────────────────
function parseFolderId(input: string): string {
  // Support both folder ID directly and full URL
  const match = input.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // If it looks like a raw ID already
  if (/^[a-zA-Z0-9_-]{25,}$/.test(input.trim())) return input.trim();
  return input.trim();
}

function getThumbnailUrl(fileId: string): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
}

function getViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

function isVideo(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

async function fetchDriveFiles(folderId: string, apiKey: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = encodeURIComponent("files(id,name,mimeType,createdTime,size,thumbnailLink)");
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=createdTime+desc&pageSize=100&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Errore ${res.status}`);
  }
  const data = await res.json();
  return data.files || [];
}

// ─── Setup panel ─────────────────────────────────────────────────────────────
function SetupPanel({ onSave }: { onSave: (folderId: string, apiKey: string) => void }) {
  const [folderInput, setFolderInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [step, setStep] = useState(1);

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "var(--gradient-primary)" }}>
          <FolderOpen className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-xl font-bold mb-2">Connetti Google Drive</h2>
        <p className="text-sm text-muted-foreground">Collega la cartella dove n8n carica le tue creative</p>
      </div>

      {/* Step 1: API Key */}
      <div className="rounded-2xl p-5 space-y-3" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center text-white" style={{ background: step >= 1 ? "var(--gradient-primary)" : "oklch(0.25 0.02 260)" }}>1</span>
          <h3 className="font-semibold text-sm">Google API Key</h3>
        </div>
        <p className="text-xs text-muted-foreground">Vai su <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-primary underline">Google Cloud Console</a> → Credenziali → Crea chiave API → abilita <b>Google Drive API</b></p>
        <Input
          placeholder="AIzaSy..."
          value={apiKey}
          onChange={(e) => { setApiKey(e.target.value); if (e.target.value.length > 10) setStep(2); }}
          style={{ background: "oklch(0.16 0.015 260)" }}
        />
      </div>

      {/* Step 2: Folder */}
      <div className="rounded-2xl p-5 space-y-3" style={{ background: "oklch(0.14 0.015 260)", border: `1px solid ${step >= 2 ? "oklch(0.25 0.02 265 / 0.6)" : "oklch(0.2 0.015 260)"}` }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center text-white" style={{ background: step >= 2 ? "var(--gradient-primary)" : "oklch(0.25 0.02 260)" }}>2</span>
          <h3 className="font-semibold text-sm">URL Cartella Google Drive</h3>
        </div>
        <p className="text-xs text-muted-foreground">Copia il link della cartella dove n8n salva le creative. La cartella deve essere <b>condivisa pubblicamente</b> (o con l'account del sito).</p>
        <Input
          placeholder="https://drive.google.com/drive/folders/1ABC..."
          value={folderInput}
          onChange={(e) => setFolderInput(e.target.value)}
          disabled={step < 2}
          style={{ background: "oklch(0.16 0.015 260)" }}
        />
      </div>

      <Button
        onClick={() => {
          if (!apiKey.trim() || !folderInput.trim()) { toast.error("Inserisci API key e URL cartella"); return; }
          const folderId = parseFolderId(folderInput);
          onSave(folderId, apiKey.trim());
        }}
        disabled={step < 2 || !folderInput.trim()}
        className="w-full text-white h-12"
        style={{ background: "var(--gradient-primary)" }}
      >
        <Link2 className="w-4 h-4 mr-2" />
        Connetti & Carica Assets
      </Button>

      {/* Telegram quick connect */}
      <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: "oklch(0.65 0.2 265 / 0.08)", border: "1px solid oklch(0.65 0.2 265 / 0.2)" }}>
        <Send className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "oklch(0.65 0.2 265)" }} />
        <div>
          <div className="text-sm font-semibold mb-1" style={{ color: "oklch(0.8 0.1 265)" }}>Genera da Telegram</div>
          <p className="text-xs text-muted-foreground">Il tuo workflow n8n riceve messaggi dal tuo telefono → genera la creative UGC → la carica automaticamente in questa cartella Drive. Le nuove creative appariranno qui dopo il refresh.</p>
        </div>
      </div>
    </div>
  );
}

// ─── Asset Card ───────────────────────────────────────────────────────────────
function AssetCard({ file, view }: { file: DriveFile; view: ViewMode }) {
  const thumb = getThumbnailUrl(file.id);
  const isVid = isVideo(file.mimeType);

  if (view === "list") {
    return (
      <div className="flex items-center gap-4 p-3 rounded-xl hover:opacity-90 transition-opacity cursor-pointer group" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}
        onClick={() => window.open(getViewUrl(file.id), "_blank")}>
        <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 relative" style={{ background: "oklch(0.16 0.015 260)" }}>
          {(isImage(file.mimeType) || isVid) ? (
            <img src={thumb} alt={file.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center"><FolderOpen className="w-5 h-5 text-muted-foreground" /></div>
          )}
          {isVid && <div className="absolute inset-0 flex items-center justify-center bg-black/30"><Video className="w-4 h-4 text-white" /></div>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{file.name}</p>
          <p className="text-xs text-muted-foreground">{formatDate(file.createdTime)}</p>
        </div>
        <Badge variant="outline" className="text-xs shrink-0">{isVid ? "Video" : isImage(file.mimeType) ? "Immagine" : "File"}</Badge>
        <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden cursor-pointer hover:scale-[1.02] transition-all group"
      style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}
      onClick={() => window.open(getViewUrl(file.id), "_blank")}>
      <div className="aspect-square relative overflow-hidden" style={{ background: "oklch(0.12 0.01 260)" }}>
        {(isImage(file.mimeType) || isVid) ? (
          <img src={thumb} alt={file.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><FolderOpen className="w-10 h-10 text-muted-foreground" /></div>
        )}
        {isVid && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Video className="w-5 h-5 text-white" />
            </div>
          </div>
        )}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-7 h-7 rounded-lg bg-black/60 backdrop-blur-sm flex items-center justify-center">
            <ExternalLink className="w-3.5 h-3.5 text-white" />
          </div>
        </div>
      </div>
      <div className="p-3">
        <p className="text-xs font-medium truncate">{file.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{formatDate(file.createdTime)}</p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AssetsLibrary() {
  const [location] = useLocation();
  const isMetaLib = location.includes("/meta/");
  const section = isMetaLib ? "META ADS" : "Social Organico";

  const LS_FOLDER = "assets_library_folder_id";
  const LS_APIKEY = "assets_library_api_key";

  const [folderId, setFolderId] = useState(() => localStorage.getItem(LS_FOLDER) || "");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(LS_APIKEY) || "");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [view, setView] = useState<ViewMode>("grid");
  const [connected, setConnected] = useState(false);

  const loadFiles = async (fId: string, aKey: string) => {
    setLoading(true); setError("");
    try {
      const result = await fetchDriveFiles(fId, aKey);
      setFiles(result);
      setConnected(true);
      toast.success(`${result.length} asset caricati da Google Drive`);
    } catch (e: any) {
      setError(e.message || "Errore nel caricamento");
      toast.error(e.message || "Errore nel caricamento");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (folderId && apiKey) loadFiles(folderId, apiKey);
  }, []);

  const handleSave = (fId: string, aKey: string) => {
    localStorage.setItem(LS_FOLDER, fId);
    localStorage.setItem(LS_APIKEY, aKey);
    setFolderId(fId); setApiKey(aKey);
    loadFiles(fId, aKey);
  };

  const filteredFiles = files.filter((f) => {
    const matchSearch = f.name.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" ? true : filter === "video" ? isVideo(f.mimeType) : isImage(f.mimeType);
    return matchSearch && matchFilter;
  });

  const stats = { total: files.length, images: files.filter(f => isImage(f.mimeType)).length, videos: files.filter(f => isVideo(f.mimeType)).length };

  if (!connected && !folderId) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
          <div className="absolute inset-0" style={{ background: "var(--gradient-primary)", opacity: 0.04 }} />
          <div className="relative">
            <h1 className="text-xl font-bold">Library — My Assets</h1>
            <p className="text-sm text-muted-foreground">Creative generate dal workflow n8n • Sezione {section}</p>
          </div>
        </div>
        <SetupPanel onSave={handleSave} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl p-5 relative overflow-hidden" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
        <div className="absolute inset-0" style={{ background: "var(--gradient-primary)", opacity: 0.04 }} />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">My Assets</h1>
            <p className="text-sm text-muted-foreground">Creative dal workflow n8n · Google Drive · {section}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Telegram UGC button */}
            <a href="https://t.me" target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm" className="gap-2 h-9">
                <Send className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Genera UGC</span>
              </Button>
            </a>
            <Button size="sm" onClick={() => loadFiles(folderId, apiKey)} disabled={loading} className="gap-2 h-9 text-white" style={{ background: "var(--gradient-primary)" }}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Aggiorna</span>
            </Button>
            <Button variant="ghost" size="sm" className="h-9 text-xs text-muted-foreground" onClick={() => { localStorage.removeItem(LS_FOLDER); localStorage.removeItem(LS_APIKEY); setConnected(false); setFolderId(""); setApiKey(""); setFiles([]); }}>
              Disconnetti
            </Button>
          </div>
        </div>
      </div>

      {/* Stats */}
      {connected && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: FolderOpen, label: "Totale asset", value: stats.total, color: "oklch(0.65 0.2 265)" },
            { icon: ImageIcon, label: "Immagini", value: stats.images, color: "oklch(0.65 0.2 310)" },
            { icon: Video, label: "Video / Reel", value: stats.videos, color: "oklch(0.6 0.18 145)" },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="rounded-2xl p-4" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
              <div className="text-2xl font-bold" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[180px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca per nome..." className="pl-9" style={{ background: "oklch(0.14 0.015 260)" }} />
        </div>
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
          {(["all", "image", "video"] as FilterType[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all" style={{ background: filter === f ? "oklch(0.65 0.2 265 / 0.2)" : "transparent", color: filter === f ? "oklch(0.8 0.1 265)" : "oklch(0.5 0.02 260)", border: filter === f ? "1px solid oklch(0.65 0.2 265 / 0.3)" : "1px solid transparent" }}>
              {f === "all" ? "Tutti" : f === "image" ? "Immagini" : "Video"}
            </button>
          ))}
        </div>
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
          <button onClick={() => setView("grid")} className="p-1.5 rounded-lg transition-all" style={{ background: view === "grid" ? "oklch(0.65 0.2 265 / 0.2)" : "transparent" }}>
            <Grid3x3 className="w-4 h-4" style={{ color: view === "grid" ? "oklch(0.8 0.1 265)" : "oklch(0.5 0.02 260)" }} />
          </button>
          <button onClick={() => setView("list")} className="p-1.5 rounded-lg transition-all" style={{ background: view === "list" ? "oklch(0.65 0.2 265 / 0.2)" : "transparent" }}>
            <List className="w-4 h-4" style={{ color: view === "list" ? "oklch(0.8 0.1 265)" : "oklch(0.5 0.02 260)" }} />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: "oklch(0.2 0.05 25 / 0.3)", border: "1px solid oklch(0.55 0.22 25 / 0.4)" }}>
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-400">Errore connessione Google Drive</p>
            <p className="text-xs text-muted-foreground mt-0.5">{error} — Assicurati che la cartella sia condivisa pubblicamente e l'API key sia valida.</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="rounded-2xl aspect-square animate-pulse" style={{ background: "oklch(0.14 0.015 260)" }} />
          ))}
        </div>
      )}

      {/* Assets grid */}
      {!loading && connected && (
        <>
          {filteredFiles.length === 0 ? (
            <div className="text-center py-16">
              <FolderOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">{files.length === 0 ? "La cartella Google Drive è vuota" : "Nessun asset corrisponde alla ricerca"}</p>
              {files.length === 0 && <p className="text-xs text-muted-foreground mt-2">Avvia il workflow n8n per generare le prime creative</p>}
            </div>
          ) : view === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredFiles.map((f) => <AssetCard key={f.id} file={f} view="grid" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredFiles.map((f) => <AssetCard key={f.id} file={f} view="list" />)}
            </div>
          )}
          <p className="text-xs text-center text-muted-foreground">{filteredFiles.length} di {files.length} asset</p>
        </>
      )}
    </div>
  );
}
