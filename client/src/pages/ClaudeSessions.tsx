import { useState, useEffect, useRef, type ElementType } from "react";
import {
  Search, Send, Plus, Brain, ArrowLeft, Archive, Trash2, Pencil,
  Globe, Terminal, MessageCircle, ArchiveRestore, Check, X,
  Mic, Paperclip, Volume2, Pause, Play, Square, FileText, Loader2,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useSpeech, useVoiceRecorder } from "@/hooks/useSpeech";

type PendingAttachment = { id: number; filename: string; mimeType: string; size: number; kind: string };

function fmtSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDuration(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
async function fileToBase64(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  // A colpi, altrimenti stack overflow sui file grossi. Niente spread: il target
  // TS del progetto non lo consente sulle TypedArray.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

// Badge origine: da dove è nata (o continua) la sessione. L'alpha va DENTRO
// oklch(), quindi ogni voce porta già la sua variante di sfondo e bordo.
const SOURCES: Record<string, { label: string; icon: ElementType; color: string; bg: string; border: string }> = {
  web:      { label: "Web",      icon: Globe,         color: "oklch(0.75 0.15 265)", bg: "oklch(0.65 0.2 265 / 0.12)",  border: "oklch(0.65 0.2 265 / 0.3)" },
  telegram: { label: "Telegram", icon: MessageCircle, color: "oklch(0.78 0.12 230)", bg: "oklch(0.7 0.15 230 / 0.12)",  border: "oklch(0.7 0.15 230 / 0.3)" },
  code:     { label: "Code",     icon: Terminal,      color: "oklch(0.8 0.14 75)",   bg: "oklch(0.72 0.18 75 / 0.12)",  border: "oklch(0.72 0.18 75 / 0.3)" },
};
const SOURCE_FALLBACK = { label: "—", icon: Globe, color: "oklch(0.7 0.02 260)", bg: "oklch(0.5 0.02 260 / 0.12)", border: "oklch(0.5 0.02 260 / 0.3)" };
function sourceMeta(s: string) {
  return SOURCES[s] ?? { ...SOURCE_FALLBACK, label: s };
}

const BORDER = "1px solid oklch(0.2 0.015 260)";
const PANEL_BG = "oklch(0.12 0.015 260)";

export default function ClaudeSessions() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Sotto 1024px si vede un pannello alla volta: lista → chat, con back button.
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [pendingAtts, setPendingAtts] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const speech = useSpeech();
  const voice = useVoiceRecorder();

  const { data: sessions = [], isLoading: loadingSessions } = trpc.claude.sessions.useQuery(
    { q: search || undefined, includeArchived },
    { refetchInterval: 8000 },
  );
  const { data: messages = [] } = trpc.claude.messages.useQuery(
    { sessionId: selectedId! },
    { enabled: selectedId != null, refetchInterval: 3500 },
  );
  const { data: agent } = trpc.claude.agentStatus.useQuery(undefined, { refetchInterval: 30000 });

  const selected = sessions.find((s) => s.id === selectedId);

  const send = trpc.claude.send.useMutation({
    onSuccess: (r) => {
      setDraft("");
      setPendingAtts([]);
      setSelectedId(r.sessionId);
      utils.claude.messages.invalidate();
      utils.claude.sessions.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const upload = trpc.claude.upload.useMutation();
  const rename = trpc.claude.rename.useMutation({
    onSuccess: () => { setRenamingId(null); utils.claude.sessions.invalidate(); toast.success("Sessione rinominata"); },
    onError: (e) => toast.error(e.message),
  });
  const setStatus = trpc.claude.setStatus.useMutation({
    onSuccess: () => { utils.claude.sessions.invalidate(); toast.success("Sessione aggiornata"); },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.claude.remove.useMutation({
    onSuccess: () => {
      setSelectedId(null);
      setMobileView("list");
      utils.claude.sessions.invalidate();
      toast.success("Sessione eliminata");
    },
    onError: (e) => toast.error(e.message),
  });

  // La chat resta incollata in fondo mentre arrivano i turni dell'agente.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, selectedId]);

  function openSession(id: number) {
    setSelectedId(id);
    setMobileView("chat");
  }

  function newSession() {
    setSelectedId(null);
    setDraft("");
    setMobileView("chat");
  }

  function submit() {
    const text = draft.trim();
    if ((!text && !pendingAtts.length) || send.isPending) return;
    send.mutate({
      sessionId: selectedId ?? undefined,
      text,
      attachmentIds: pendingAtts.map((a) => a.id),
    });
  }

  // Upload di file scelti col graffetta. Ogni file diventa un allegato "in attesa",
  // mostrato sopra il composer finche' non parte il messaggio.
  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 15 * 1024 * 1024) {
          toast.error(`${file.name}: troppo grande (max 15MB)`);
          continue;
        }
        const r = await upload.mutateAsync({
          sessionId: selectedId ?? undefined,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          kind: file.type.startsWith("image/") ? "image" : "file",
          dataBase64: await fileToBase64(file),
        });
        if (selectedId == null) setSelectedId(r.sessionId);
        setPendingAtts((prev) => [...prev, {
          id: r.id, filename: file.name, mimeType: file.type,
          size: r.size, kind: file.type.startsWith("image/") ? "image" : "file",
        }]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload fallito");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Note vocali: audio come allegato + trascrizione come testo del messaggio,
  // perche' l'agente legge testo, non ascolta.
  async function startVoice() {
    try {
      await voice.start();
    } catch {
      toast.error("Microfono non disponibile: controlla i permessi del browser");
    }
  }

  async function stopVoiceAndSend() {
    const res = await voice.stop();
    if (!res) return;
    if (res.blob.size < 1200) { toast.info("Vocale troppo corto"); return; }
    setUploading(true);
    try {
      const r = await upload.mutateAsync({
        sessionId: selectedId ?? undefined,
        filename: `vocale-${new Date().toISOString().slice(11, 19).replace(/:/g, "-")}.webm`,
        mimeType: res.blob.type || "audio/webm",
        kind: "voice",
        transcript: res.transcript || undefined,
        dataBase64: await fileToBase64(res.blob),
      });
      const sid = selectedId ?? r.sessionId;
      setSelectedId(sid);
      send.mutate({
        sessionId: sid,
        text: res.transcript || "[messaggio vocale senza trascrizione]",
        attachmentIds: [r.id],
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invio vocale fallito");
    } finally {
      setUploading(false);
    }
  }

  const online = agent?.online ?? false;
  // "Sta scrivendo": c'e' un mio messaggio ancora non gestito dall'agente.
  // Se l'agente e' offline non e' onesto dire che scrive: lo dico com'e'.
  const waitingReply = messages.some((m) => m.pending);
  const hasText = draft.trim().length > 0;

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)] relative">
      {/* Overlay lettura vocale (stile Gemini): pausa/riprendi sempre a portata,
          anche se scrolli via dal messaggio che sta parlando. */}
      {speech.speakingId != null && (
        <div className="fixed top-20 right-4 z-50 flex items-center gap-1.5 rounded-full pl-3 pr-1.5 py-1.5 shadow-lg"
             style={{ background: "oklch(0.16 0.015 260)", border: "1px solid oklch(0.65 0.2 265 / 0.4)" }}>
          <span className="text-xs text-muted-foreground">{speech.paused ? "In pausa" : "Sto leggendo"}</span>
          <button
            onClick={speech.toggle}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white"
            style={{ background: "var(--gradient-primary)" }}
            title={speech.paused ? "Riprendi" : "Pausa"}
          >
            {speech.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
          <button
            onClick={speech.stop}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground"
            title="Chiudi"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* ── Lista sessioni ─────────────────────────────────────────── */}
      <aside
        className={`${mobileView === "list" ? "flex" : "hidden"} lg:flex flex-col w-full lg:w-80 shrink-0 rounded-2xl overflow-hidden`}
        style={{ background: PANEL_BG, border: BORDER }}
      >
        <div className="p-3 space-y-3 shrink-0" style={{ borderBottom: BORDER }}>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-sm font-semibold truncate">Sessioni</span>
              {/* Pallino stato agente: verde = ha battuto un colpo negli ultimi 2 min */}
              <span
                className="flex items-center gap-1.5 text-[11px] shrink-0"
                title={online ? "Agente Claude online" : "Agente Claude offline"}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: online ? "oklch(0.7 0.18 145)" : "oklch(0.5 0.02 260)",
                    boxShadow: online ? "0 0 6px oklch(0.7 0.18 145)" : "none",
                  }}
                />
                <span className="text-muted-foreground">{online ? "online" : "offline"}</span>
              </span>
            </div>
            <Button size="sm" onClick={newSession} style={{ background: "var(--gradient-primary)" }} className="h-8">
              <Plus className="w-4 h-4" />
              <span className="ml-1 text-xs">Nuova</span>
            </Button>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca nei titoli e nei messaggi…"
              className="pl-8 h-9 text-sm"
            />
          </div>
          <button
            onClick={() => setIncludeArchived((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {includeArchived ? "✓ Mostra archiviate" : "Mostra archiviate"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loadingSessions && <div className="text-xs text-muted-foreground p-3">Carico…</div>}
          {!loadingSessions && sessions.length === 0 && (
            <div className="text-xs text-muted-foreground p-3 leading-relaxed">
              {search ? "Nessuna sessione trovata." : "Nessuna sessione. Premi Nuova per iniziare."}
            </div>
          )}
          {sessions.map((s) => {
            const meta = sourceMeta(s.source);
            const Icon = meta.icon;
            const isActive = s.id === selectedId;
            return (
              <div
                key={s.id}
                onClick={() => renamingId !== s.id && openSession(s.id)}
                className={`group p-2.5 rounded-xl cursor-pointer transition-all ${isActive ? "sidebar-item-active" : "hover:bg-accent"}`}
                style={isActive ? { background: "oklch(0.65 0.2 265 / 0.12)", border: "1px solid oklch(0.65 0.2 265 / 0.3)" } : { border: "1px solid transparent" }}
              >
                {renamingId === s.id ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && renameValue.trim()) rename.mutate({ id: s.id, title: renameValue.trim() });
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="h-7 text-xs"
                    />
                    <button
                      onClick={() => renameValue.trim() && rename.mutate({ id: s.id, title: renameValue.trim() })}
                      className="p-1 rounded text-muted-foreground hover:text-foreground"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setRenamingId(null)} className="p-1 rounded text-muted-foreground hover:text-foreground">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate flex-1">{s.title}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{s.when}</span>
                    </div>
                    {s.preview && <div className="text-xs text-muted-foreground truncate mt-0.5">{s.preview}</div>}
                    <div className="flex items-center gap-2 mt-1.5">
                      <span
                        className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md"
                        style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}
                      >
                        <Icon className="w-2.5 h-2.5" />
                        {meta.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{s.messageCount} msg</span>
                      {s.status === "archived" && <span className="text-[10px] text-muted-foreground">· archiviata</span>}
                      <span className="flex-1" />
                      <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => { setRenamingId(s.id); setRenameValue(s.title); }}
                          className="p-1 rounded text-muted-foreground hover:text-foreground"
                          title="Rinomina"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setStatus.mutate({ id: s.id, status: s.status === "archived" ? "active" : "archived" })}
                          className="p-1 rounded text-muted-foreground hover:text-foreground"
                          title={s.status === "archived" ? "Ripristina" : "Archivia"}
                        >
                          {s.status === "archived" ? <ArchiveRestore className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={() => { if (confirm(`Eliminare "${s.title}"? I messaggi vanno persi.`)) remove.mutate({ id: s.id }); }}
                          className="p-1 rounded text-muted-foreground hover:text-destructive"
                          title="Elimina"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── Chat ───────────────────────────────────────────────────── */}
      <section
        className={`${mobileView === "chat" ? "flex" : "hidden"} lg:flex flex-col flex-1 min-w-0 rounded-2xl overflow-hidden`}
        style={{ background: PANEL_BG, border: BORDER }}
      >
        <div className="flex items-center gap-3 p-3 shrink-0" style={{ borderBottom: BORDER }}>
          <button onClick={() => setMobileView("list")} className="lg:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--gradient-primary)" }}>
            <Brain className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">{selected?.title ?? "Nuova sessione"}</div>
            <div className="text-[11px] text-muted-foreground">
              {selected ? `${selected.messageCount} messaggi` : "Scrivi per iniziare una sessione"}
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {selectedId == null && (
            <div className="h-full flex items-center justify-center text-center px-6">
              <div>
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: "var(--gradient-primary)" }}>
                  <Brain className="w-6 h-6 text-white" />
                </div>
                <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                  Le tue sessioni Claude, ovunque. Scrivi qui e riprendi da Claude Code, o continua da mobile quello che hai iniziato al PC.
                </p>
              </div>
            </div>
          )}
          {messages.map((m) => {
            const isUser = m.role === "user";
            if (m.role === "system") {
              return (
                <div key={m.id} className="text-[11px] text-muted-foreground text-center italic px-4">{m.text}</div>
              );
            }
            return (
              <div key={m.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[85%] rounded-2xl px-3.5 py-2.5"
                  style={isUser
                    ? { background: "var(--gradient-primary)", color: "white" }
                    : { background: "oklch(0.16 0.015 260)", border: BORDER }}
                >
                  {isUser ? (
                    <div className="text-sm whitespace-pre-wrap break-words">{m.text}</div>
                  ) : (
                    <div className="text-sm claude-md break-words">
                      <Streamdown>{m.text}</Streamdown>
                    </div>
                  )}

                  {/* Allegati: immagini inline, vocali col player, il resto come link */}
                  {m.attachments?.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {m.attachments.map((a) => {
                        if (a.kind === "image") {
                          return (
                            <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block">
                              <img src={a.url} alt={a.filename} className="rounded-lg max-h-60 w-auto" style={{ border: BORDER }} />
                            </a>
                          );
                        }
                        if (a.kind === "voice") {
                          return <audio key={a.id} controls src={a.url} className="w-full max-w-[260px] h-9" />;
                        }
                        return (
                          <a
                            key={a.id}
                            href={`${a.url}?download=1`}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs"
                            style={{ background: "oklch(0.2 0.015 260 / 0.6)", border: BORDER }}
                          >
                            <FileText className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate flex-1">{a.filename}</span>
                            <span className="text-muted-foreground shrink-0">{fmtSize(a.size)}</span>
                          </a>
                        );
                      })}
                    </div>
                  )}

                  <div className={`flex items-center gap-2 mt-1 ${isUser ? "text-white/60" : "text-muted-foreground"}`}>
                    <span className="text-[10px]">
                      {m.when}
                      {m.pending && " · in attesa dell'agente"}
                    </span>
                    {/* Leggi ad alta voce (solo le risposte di Claude) */}
                    {!isUser && speech.supported && (
                      <button
                        onClick={() => speech.speak(m.id, m.text)}
                        className="p-1 rounded-md hover:text-foreground hover:bg-accent transition-colors"
                        title={speech.speakingId === m.id ? "Ferma la lettura" : "Leggi ad alta voce"}
                      >
                        {speech.speakingId === m.id
                          ? <Square className="w-3.5 h-3.5" style={{ color: "oklch(0.65 0.2 265)" }} />
                          : <Volume2 className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* "Claude sta scrivendo…" — c'e' un messaggio non ancora gestito.
              Se l'agente e' spento lo dico, invece di far finta che stia scrivendo. */}
          {waitingReply && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-3.5 py-2.5 flex items-center gap-2" style={{ background: "oklch(0.16 0.015 260)", border: BORDER }}>
                {online ? (
                  <>
                    <span className="text-xs text-muted-foreground">Claude sta scrivendo</span>
                    <span className="flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="w-1.5 h-1.5 rounded-full claude-typing-dot"
                          style={{ background: "oklch(0.65 0.2 265)", animationDelay: `${i * 0.18}s` }}
                        />
                      ))}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">In coda — l'agente Claude è offline</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="p-3 shrink-0" style={{ borderTop: BORDER }}>
          {/* Allegati pronti da inviare */}
          {pendingAtts.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {pendingAtts.map((a) => (
                <span
                  key={a.id}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs"
                  style={{ background: "oklch(0.2 0.015 260 / 0.6)", border: BORDER }}
                >
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-[140px]">{a.filename}</span>
                  <span className="text-muted-foreground">{fmtSize(a.size)}</span>
                  <button
                    onClick={() => setPendingAtts((p) => p.filter((x) => x.id !== a.id))}
                    className="text-muted-foreground hover:text-destructive"
                    title="Togli"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {voice.recording ? (
            /* Modalità registrazione: pallino rosso, durata, e cosa sta capendo */
            <div className="flex items-center gap-3">
              <button onClick={voice.cancel} className="p-2 rounded-xl text-muted-foreground hover:text-destructive" title="Annulla">
                <Trash2 className="w-5 h-5" />
              </button>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 claude-rec-dot" style={{ background: "oklch(0.6 0.24 25)" }} />
                <span className="text-sm tabular-nums shrink-0">{fmtDuration(voice.seconds)}</span>
                <span className="text-xs text-muted-foreground truncate">
                  {voice.transcript || "sto ascoltando…"}
                </span>
              </div>
              <Button onClick={stopVoiceAndSend} disabled={uploading} className="h-11 shrink-0" style={{ background: "var(--gradient-primary)" }}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          ) : (
            <div className="flex gap-2 items-end">
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => onPickFiles(e.target.files)}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="h-11 w-10 shrink-0 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                title="Allega file"
              >
                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
              </button>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
                }}
                placeholder="Scrivi a Claude… (Enter invia, Shift+Enter a capo)"
                className="min-h-[44px] max-h-40 resize-none text-sm"
                rows={1}
              />
              {/* Come Telegram: vuoto = microfono, appena scrivi = invio */}
              <Button
                onClick={hasText || pendingAtts.length ? submit : startVoice}
                disabled={send.isPending || uploading || (!hasText && !pendingAtts.length && !voice.supported)}
                className="h-11 shrink-0"
                style={{ background: "var(--gradient-primary)" }}
                title={hasText || pendingAtts.length ? "Invia" : "Tieni premuto per un vocale"}
              >
                {send.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : hasText || pendingAtts.length
                    ? <Send className="w-4 h-4" />
                    : <Mic className="w-4 h-4" />}
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
