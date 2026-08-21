import { useState, useEffect, type ElementType } from "react";
import { Instagram, Facebook, MessageSquare, Clock, Pencil, Bot, Inbox, Check, Trash2, FileText, Twitter, Sparkles, Upload, Loader2, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

const CARD = { background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" };

/* ------------------------------------------------------------------ */
/* Materiale per la notte del Social Media Manager (run 01:00)          */
/*                                                                     */
/* Stesso meccanismo di Approva Design: le reference si caricano da qui */
/* e finiscono nella repo dell'agente, che il VPS legge al run. Qui pero'*/
/* una reference e' uno SCREENSHOT DI UN POST che funziona: l'agente ne */
/* prende struttura, ritmo e angolo, mai le parole.                     */
/* ------------------------------------------------------------------ */

const MODI_SOCIAL = [
  { id: "caricate", label: "Carico io", desc: "Parti dagli screenshot che carico qui sotto" },
  { id: "profilo", label: "Da un profilo", desc: "Prendi i post migliori da questo profilo Instagram" },
  { id: "auto", label: "Automatico", desc: "Pesca dai canali che seguo nella Watchlist" },
] as const;

const TIPI_SOCIAL = [
  { id: "ispirazione", label: "ispirazione", icona: "💡", desc: "post altrui che funzionano" },
  { id: "prodotto", label: "prodotto", icona: "🛍", desc: "per i caroselli IKONICK" },
] as const;

function MaterialeNotteSocial() {
  const utils = trpc.useUtils();
  const fonte = trpc.social.fonte.useQuery();
  const reference = trpc.social.reference.useQuery();

  const [modo, setModo] = useState<"caricate" | "profilo" | "auto">("caricate");
  const [handle, setHandle] = useState("");
  const [tipo, setTipo] = useState<"ispirazione" | "prodotto">("ispirazione");
  const [caricando, setCaricando] = useState(0);

  useEffect(() => {
    if (!fonte.data) return;
    setModo(fonte.data.modo);
    setHandle(fonte.data.handle ?? "");
  }, [fonte.data]);

  // L'anteprima dei post da cui partirà la notte: si controlla prima, non dopo.
  const anteprima = trpc.social.postDiRiferimento.useQuery(
    { handle: modo === "profilo" ? fonte.data?.handle : undefined, limit: 6 },
    { enabled: modo !== "caricate", retry: false },
  );

  const salva = trpc.social.setFonte.useMutation({
    onSuccess: () => { toast.success("Impostazione salvata per stanotte"); utils.social.fonte.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const carica = trpc.social.caricaReference.useMutation({ onError: (e) => toast.error(e.message) });
  const elimina = trpc.social.eliminaReference.useMutation({
    onSuccess: () => { toast.success("Reference rimossa"); utils.social.reference.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setCaricando(files.length);
    let ok = 0;
    for (const file of Array.from(files)) {
      try {
        const base64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).split(",")[1] ?? "");
          r.onerror = () => rej(new Error(`non riesco a leggere ${file.name}`));
          r.readAsDataURL(file);
        });
        await carica.mutateAsync({ tipo, nomeFile: file.name, base64 });
        ok++;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `errore su ${file.name}`);
      }
      setCaricando((n) => n - 1);
    }
    if (ok) {
      toast.success(`${ok} reference caricate`);
      utils.social.reference.invalidate();
      // Caricare implica volerle usare: si allinea il modo senza farglielo ricordare.
      if (modo !== "caricate") salva.mutate({ modo: "caricate" });
    }
  };

  const files = reference.data ?? [];
  const perTipo = (t: string) => files.filter((f) => f.tipo === t);

  return (
    <div className="rounded-xl p-4 space-y-4" style={CARD}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 opacity-70" /> Materiale per la prossima notte
          </h2>
          <p className="text-xs opacity-55 mt-0.5">
            Da cosa deve partire il Social Media Manager all'01:00. Scrive 3 Instagram, 2 Pinterest e 1 Facebook, e le trovi qui sotto come bozze.
          </p>
        </div>
        {fonte.data?.aggiornatoIl && (
          <span className="text-[11px] opacity-45">
            impostato il {new Date(fonte.data.aggiornatoIl).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        {MODI_SOCIAL.map((m) => {
          const attivo = modo === m.id;
          return (
            <button
              key={m.id}
              onClick={() => { setModo(m.id); if (m.id !== "profilo") salva.mutate({ modo: m.id }); }}
              disabled={salva.isPending}
              className="text-left rounded-lg px-3 py-2 transition-colors"
              style={{
                background: attivo ? "oklch(0.25 0.06 250)" : "oklch(0.11 0.015 260)",
                border: `1px solid ${attivo ? "oklch(0.5 0.14 250)" : "oklch(0.2 0.015 260)"}`,
              }}
            >
              <div className="text-sm font-medium">{m.label}</div>
              <div className="text-[11px] opacity-55 leading-snug mt-0.5">{m.desc}</div>
            </button>
          );
        })}
      </div>

      {modo === "profilo" && (
        <div className="flex gap-2 flex-wrap items-center">
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="https://instagram.com/poeta_della_serra  oppure  @poeta_della_serra"
            className="flex-1 min-w-[260px] bg-transparent text-sm rounded-lg px-3 py-2 outline-none"
            style={{ border: "1px solid oklch(0.25 0.015 260)" }}
          />
          <Button size="sm" disabled={salva.isPending || !handle.trim()}
                  onClick={() => salva.mutate({ modo: "profilo", handle })}>
            Salva profilo
          </Button>
          <p className="w-full text-[11px] opacity-50">
            Il profilo viene aggiunto alla <b>Watchlist</b>, che ne raccoglie i post con metriche e outlier score. La notte l'agente parte dai migliori: ne studia struttura, ritmo e attacco, e riscrive con la nostra voce.
          </p>
        </div>
      )}

      {modo !== "caricate" && (
        <div className="text-xs">
          {anteprima.isLoading && <span className="opacity-50">carico i post di riferimento…</span>}
          {anteprima.error && (
            <span style={{ color: "oklch(0.7 0.18 25)" }}>{anteprima.error.message}</span>
          )}
          {anteprima.data && anteprima.data.length === 0 && (
            <span style={{ color: "oklch(0.78 0.15 70)" }}>
              Nessun post disponibile: la Watchlist non ha ancora raccolto niente da questi profili. Aggiornala da <b>Watchlist</b>, oppure carica tu gli screenshot.
            </span>
          )}
          {anteprima.data && anteprima.data.length > 0 && (
            <div>
              <div className="opacity-55 mb-2">
                Stanotte partirà da questi {anteprima.data.length} post:
              </div>
              <div className="flex flex-wrap gap-2">
                {anteprima.data.map((p) => (
                  <a key={p.url} href={p.url} target="_blank" rel="noreferrer"
                     className="flex items-center gap-2 px-2 py-1.5 rounded-lg max-w-[320px] transition-colors hover:bg-white/5"
                     style={{ background: "oklch(0.11 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
                    {/* Instagram blocca l'hotlink delle miniature: se non carica
                        si nasconde, invece di lasciare l'icona spezzata. */}
                    {p.thumbnailUrl && (
                      <img src={p.thumbnailUrl} alt="" referrerPolicy="no-referrer"
                           className="w-8 h-8 rounded object-cover shrink-0"
                           onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate opacity-80">{p.caption ?? "(senza testo)"}</span>
                      <span className="block opacity-45 text-[10px]">
                        @{p.handle}
                        {p.outlierScore ? ` · ${p.outlierScore.toFixed(1)}x` : ""}
                        {p.views ? ` · ${Intl.NumberFormat("it-IT", { notation: "compact" }).format(p.views)} views` : ""}
                      </span>
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="pt-1" style={{ borderTop: "1px solid oklch(0.2 0.015 260)" }}>
        <div className="flex items-center gap-2 flex-wrap pt-3">
          <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid oklch(0.25 0.015 260)" }}>
            {TIPI_SOCIAL.map((t) => (
              <button
                key={t.id}
                onClick={() => setTipo(t.id)}
                title={t.desc}
                className="px-3 py-1.5 text-xs transition-colors"
                style={{ background: tipo === t.id ? "oklch(0.25 0.06 250)" : "transparent" }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <label className="cursor-pointer">
            <input type="file" accept="image/*" multiple className="hidden"
                   onChange={(e) => { onFiles(e.target.files); e.currentTarget.value = ""; }} />
            <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors hover:bg-white/5"
                  style={{ border: "1px solid oklch(0.25 0.015 260)" }}>
              {caricando > 0 ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {caricando > 0 ? `carico ${caricando}…` : "Carica reference"}
            </span>
          </label>

          <span className="text-[11px] opacity-45">
            {files.length
              ? `${perTipo("ispirazione").length} ispirazione · ${perTipo("prodotto").length} prodotto`
              : "nessuna reference caricata per la prossima notte"}
          </span>
        </div>

        <p className="text-[11px] opacity-50 mt-2">
          In <b>ispirazione</b> vanno gli screenshot di post che hanno funzionato: l'agente ne prende struttura, ritmo e attacco, e riscrive con la nostra voce — mai le parole altrui.
          In <b>prodotto</b> le immagini per i caroselli in stile IKONICK, che escono ogni 50-100 post.
        </p>

        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {files.map((f) => (
              <span key={f.path}
                    className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md"
                    style={{ background: "oklch(0.11 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
                <span className="opacity-45">{f.tipo === "ispirazione" ? "💡" : "🛍"}</span>
                <span className="max-w-[190px] truncate">{f.nome}</span>
                <button onClick={() => elimina.mutate({ path: f.path })}
                        disabled={elimina.isPending}
                        className="opacity-45 hover:opacity-100" title="Rimuovi">
                  <XIcon className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const PLATFORMS: Record<string, { label: string; icon: ElementType; color: string }> = {
  instagram: { label: "Instagram", icon: Instagram, color: "oklch(0.65 0.2 340)" },
  facebook: { label: "Facebook", icon: Facebook, color: "oklch(0.5 0.18 265)" },
  pinterest: { label: "Pinterest", icon: MessageSquare, color: "oklch(0.6 0.22 25)" },
  shopify_blog: { label: "Blog Shopify", icon: FileText, color: "oklch(0.7 0.15 150)" },
  x: { label: "X (Twitter)", icon: Twitter, color: "oklch(0.75 0.02 260)" },
};
const STATUS_LABEL: Record<string, string> = { draft: "Bozza", scheduled: "Pianificato", published: "Pubblicato", rejected: "Rifiutato" };

export default function SocialDrafts() {
  const utils = trpc.useUtils();
  const drafts = trpc.social.draftsList.useQuery(undefined, { refetchInterval: 8000 });
  const update = trpc.social.draftUpdate.useMutation({ onSuccess: () => utils.social.draftsList.invalidate() });
  const del = trpc.social.draftDelete.useMutation({ onSuccess: () => utils.social.draftsList.invalidate() });

  type Draft = NonNullable<typeof drafts.data>[number];
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<{ title: string; caption: string; hashtags: string }>({ title: "", caption: "", hashtags: "" });

  const list: Draft[] = drafts.data ?? [];
  const startEdit = (d: Draft) => { setEditId(d.id); setForm({ title: d.title ?? "", caption: d.caption ?? "", hashtags: d.hashtags ?? "" }); };
  const saveEdit = () => { if (editId == null) return; update.mutate({ id: editId, ...form }); setEditId(null); };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl p-6 flex items-center gap-4" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}><Inbox className="w-6 h-6 text-white" /></div>
        <div>
          <h1 className="text-xl font-bold">Bozze da revisionare</h1>
          <p className="text-sm text-muted-foreground">Contenuti generati dall'AI in attesa della tua approvazione — modificabili e pianificabili</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs px-3 py-2 rounded-xl" style={{ background: "oklch(0.65 0.2 265 / 0.12)", border: "1px solid oklch(0.65 0.2 265 / 0.3)", color: "oklch(0.75 0.15 265)" }}><Bot className="w-3.5 h-3.5" /> {list.length} bozze</div>
      </div>

      <MaterialeNotteSocial />

      {list.length === 0 && (
        <div className="rounded-2xl p-10 text-center text-sm text-muted-foreground" style={{ background: "oklch(0.13 0.015 260)", border: "1px dashed oklch(0.22 0.015 260)" }}>
          Nessuna bozza ancora. Genera contenuti da <b>Crea Post</b> o lascia lavorare l'AI Manager: le bozze appariranno qui. ✨
        </div>
      )}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {list.map((d) => {
          const p = PLATFORMS[d.platform] ?? PLATFORMS.instagram; const Icon = p.icon;
          const editing = editId === d.id;
          return (
            <div key={d.id} className="rounded-2xl p-5 flex flex-col" style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="rounded-lg flex items-center justify-center" style={{ width: 28, height: 28, background: `${p.color}22`, border: `1px solid ${p.color}44` }}><Icon className="w-3.5 h-3.5" style={{ color: p.color }} /></div>
                <span className="text-sm font-medium">{p.label}</span>
                <span className="text-xs px-2 py-0.5 rounded-full ml-auto" style={{ background: "oklch(0.2 0.02 260)", color: "oklch(0.7 0.02 260)" }}>{d.format}</span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "oklch(0.65 0.2 265 / 0.15)", color: "oklch(0.75 0.15 265)" }}>{STATUS_LABEL[d.status] ?? d.status}</span>
              </div>

              {editing ? (
                <div className="space-y-2">
                  <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Titolo" className="w-full text-sm rounded-lg px-3 py-2 bg-transparent text-foreground" style={{ border: "1px solid oklch(0.22 0.015 260)" }} />
                  <Textarea value={form.caption} onChange={(e) => setForm((f) => ({ ...f, caption: e.target.value }))} rows={5} placeholder="Caption" className="resize-none text-sm" style={{ background: "oklch(0.16 0.015 260)", border: "1px solid oklch(0.22 0.015 260)" }} />
                  <Textarea value={form.hashtags} onChange={(e) => setForm((f) => ({ ...f, hashtags: e.target.value }))} rows={2} placeholder="#hashtag" className="resize-none text-sm text-primary" style={{ background: "oklch(0.16 0.015 260)", border: "1px solid oklch(0.22 0.015 260)" }} />
                  <div className="flex gap-2">
                    <Button size="sm" className="h-8 text-white" style={{ background: "var(--gradient-primary)" }} disabled={update.isPending} onClick={saveEdit}><Check className="w-3.5 h-3.5 mr-1" />Salva</Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditId(null)}>Annulla</Button>
                  </div>
                </div>
              ) : (
                <>
                  <h3 className="font-semibold text-sm mb-1">{d.title || "(senza titolo)"}</h3>
                  <p className="text-xs text-muted-foreground flex-1 whitespace-pre-line line-clamp-5">{d.caption || "—"}</p>
                  {d.hashtags && <p className="text-xs text-primary mt-2 line-clamp-2">{d.hashtags}</p>}
                  <div className="flex gap-2 mt-3 pt-3 items-center" style={{ borderTop: "1px solid oklch(0.2 0.015 260)" }}>
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => startEdit(d)}><Pencil className="w-3.5 h-3.5 mr-1" />Modifica</Button>
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-red-400" onClick={() => del.mutate({ id: d.id })}><Trash2 className="w-3.5 h-3.5 mr-1" />Elimina</Button>
                    <Button size="sm" className="h-8 px-3 text-xs text-white ml-auto" style={{ background: "var(--gradient-primary)" }} disabled={update.isPending} onClick={() => update.mutate({ id: d.id, status: "scheduled" })}><Clock className="w-3.5 h-3.5 mr-1" />Approva &amp; Pianifica</Button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
