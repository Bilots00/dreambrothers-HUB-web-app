import { useState, useEffect, useMemo, type ElementType } from "react";
import { Instagram, Facebook, MessageSquare, Clock, Pencil, Bot, Inbox, Check, Trash2, FileText, Twitter, Sparkles, Upload, Loader2, X as XIcon, Calendar1, ChevronDown, Moon, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";

/* ------------------------------------------------------------------ */
/* Selettore notte, come in Approva Design: le bozze si guardano per   */
/* notte di produzione, non tutte insieme in un rotolo infinito. I     */
/* giorni senza bozze non sono cliccabili.                             */
/* ------------------------------------------------------------------ */

const ISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const daISO = (s: string) => {
  const [y, m, g] = s.split("-").map(Number);
  return new Date(y, m - 1, g);
};

const etichettaData = (s?: string) => {
  if (!s) return "—";
  const oggi = ISO(new Date());
  const ieri = ISO(new Date(Date.now() - 86_400_000));
  if (s === oggi) return "Stanotte";
  if (s === ieri) return "Ieri";
  return daISO(s).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "long", year: "numeric" });
};

function SelettoreNotte({
  disponibili, valore, onChange,
}: { disponibili: string[]; valore?: string; onChange: (d: string) => void }) {
  const [aperto, setAperto] = useState(false);
  const [mese, setMese] = useState<Date>(valore ? daISO(valore) : new Date());

  const set = useMemo(() => new Set(disponibili), [disponibili]);
  const conBozze = useMemo(() => disponibili.map(daISO), [disponibili]);
  const scegli = (iso: string) => { onChange(iso); setAperto(false); };

  // Stanotte e ieri sono SEMPRE selezionabili, anche se non hanno bozze: e'
  // l'unico modo che ha Andrea per distinguere "l'agente non ha prodotto
  // niente" da "il calendario e' rotto". Prima erano condizionate a set.has(),
  // quindi la notte a zero spariva dal calendario invece di mostrarsi vuota.
  const scorciatoie = [
    { label: "Stanotte", iso: ISO(new Date()) },
    { label: "Ieri", iso: ISO(new Date(Date.now() - 86_400_000)) },
    { label: "Ultima notte con bozze", iso: disponibili[0] },
    { label: "Tutte", iso: "tutte" },
  ].filter((s) => s.iso);

  return (
    <Popover open={aperto} onOpenChange={setAperto}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 font-normal">
          <Calendar1 className="w-4 h-4 opacity-70" />
          <span>{valore === "tutte" ? "Tutte le notti" : etichettaData(valore)}</span>
          {valore && valore !== "tutte" && <span className="opacity-45 text-xs">{valore}</span>}
          <ChevronDown className="w-3.5 h-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-auto p-0" style={CARD}>
        <div className="flex">
          <div className="p-2 flex flex-col gap-0.5 min-w-[150px]"
               style={{ borderRight: "1px solid oklch(0.2 0.015 260)" }}>
            {scorciatoie.map((s) => (
              <button key={s.label} onClick={() => scegli(s.iso!)}
                      className="text-left text-sm px-3 py-1.5 rounded-md hover:bg-white/5 transition-colors"
                      style={valore === s.iso ? { background: "oklch(0.22 0.02 260)" } : undefined}>
                {s.label}
              </button>
            ))}
            <div className="mt-1 pt-2 px-3 text-[11px] opacity-45"
                 style={{ borderTop: "1px solid oklch(0.2 0.015 260)" }}>
              {disponibili.length} notti con bozze · le altre si aprono vuote
            </div>
          </div>
          <Calendar
            mode="single"
            month={mese}
            onMonthChange={setMese}
            selected={valore && valore !== "tutte" ? daISO(valore) : undefined}
            onSelect={(d) => d && scegli(ISO(d))}
            // Si blocca solo il futuro: una notte non ancora arrivata non puo'
            // avere bozze. Le notti passate senza bozze restano cliccabili e
            // mostrano lo stato vuoto, che e' un'informazione, non un errore.
            disabled={(d) => ISO(d) > ISO(new Date())}
            modifiers={{ conBozze }}
            modifiersStyles={{ conBozze: { fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 3 } }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** L'immagine generata dall'agente: si chiede solo per la bozza che la mostra. */
function ImmagineBozza({ id }: { id: number }) {
  const q = trpc.social.draftAssets.useQuery({ id }, { staleTime: 5 * 60_000 });
  const src = q.data?.[0];
  if (!src) return null;
  return (
    <img src={src} alt="" className="w-full rounded-lg mb-3"
         style={{ maxHeight: 260, objectFit: "cover", border: "1px solid oklch(0.2 0.015 260)" }} />
  );
}

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
  { id: "link", label: "Da un link/URL", desc: "Parti da questi post preciso, caroselli compresi" },
  { id: "auto", label: "Automatico", desc: "A cascata: caricate → link → cartella PC → Watchlist" },
] as const;

/* I quattro livelli della cascata, nell'ordine deciso il 2026-08-27. La
   Watchlist e' l'ULTIMO ripiego: e' l'unica fonte che non passa dalle mani di
   Andrea, quindi vale solo quando le altre tre sono a secco. */
const NOMI_LIVELLO: Record<string, { label: string; icona: string }> = {
  caricate: { label: "Caricate a mano", icona: "1" },
  link: { label: "Post da URL", icona: "2" },
  cartella: { label: "Cartella del PC", icona: "3" },
  watchlist: { label: "Watchlist", icona: "4" },
};

const TIPI_SOCIAL = [
  { id: "ispirazione", label: "ispirazione", icona: "💡", desc: "post altrui che funzionano" },
  { id: "prodotto", label: "prodotto", icona: "🛍", desc: "per i caroselli IKONICK" },
] as const;

function MaterialeNotteSocial() {
  const utils = trpc.useUtils();
  const fonte = trpc.social.fonte.useQuery();
  const reference = trpc.social.reference.useQuery();
  // Il piano della notte: gli stessi quattro livelli che leggera' l'agente.
  const piano = trpc.social.piano.useQuery(undefined, { retry: false });
  const linkList = trpc.social.linkReference.useQuery(undefined, { retry: false });
  // Quante reference della cartella del PC sono ancora libere, e quante sono
  // impegnate in attesa del tuo giudizio: e' il registro, visto da qui.
  const cartella = trpc.social.cartellaPc.useQuery(undefined, { retry: false });

  const [modo, setModo] = useState<"caricate" | "profilo" | "link" | "auto">("caricate");
  const [handle, setHandle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
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
    { enabled: modo === "profilo" || modo === "auto", retry: false },
  );

  const salva = trpc.social.setFonte.useMutation({
    onSuccess: () => { toast.success("Impostazione salvata per stanotte"); utils.social.fonte.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const carica = trpc.social.caricaReference.useMutation({ onError: (e) => toast.error(e.message) });
  const aggiungiLink = trpc.social.aggiungiLink.useMutation({
    onSuccess: () => {
      setLinkUrl("");
      toast.success("Post aggiunto alla coda di stanotte");
      utils.social.linkReference.invalidate();
      utils.social.piano.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const rimuoviLink = trpc.social.rimuoviLink.useMutation({
    onSuccess: () => { utils.social.linkReference.invalidate(); utils.social.piano.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
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
      utils.social.piano.invalidate();
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

      {modo === "link" && (
        <div className="space-y-2">
          <div className="flex gap-2 flex-wrap items-center">
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && linkUrl.trim()) aggiungiLink.mutate({ url: linkUrl }); }}
              placeholder="https://www.instagram.com/p/ABC123/  —  il link del POST, non del profilo"
              className="flex-1 min-w-[280px] bg-transparent text-sm rounded-lg px-3 py-2 outline-none"
              style={{ border: "1px solid oklch(0.25 0.015 260)" }}
            />
            <Button size="sm" disabled={aggiungiLink.isPending || !linkUrl.trim()}
                    onClick={() => aggiungiLink.mutate({ url: linkUrl })}>
              Aggiungi post
            </Button>
            <p className="w-full text-[11px] opacity-50">
              Qui vanno i post <b>precisi</b> da cui vuoi partire, <b>caroselli compresi</b> — che nella Watchlist entrano con la sola copertina. L'agente sul VPS è loggato a Instagram con l'account di servizio: apre il post, legge tutte le slide e la caption, e ne studia struttura, ritmo e attacco. Le parole restano nostre.
            </p>
          </div>

          {(linkList.data?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {linkList.data!.map((l) => (
                <div key={l.shortcode}
                     className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs"
                     style={{ background: "oklch(0.11 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
                  <a href={l.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {l.tipo === "carosello" ? "🎠" : l.tipo === "reel" ? "🎬" : "🖼"} {l.shortcode}
                  </a>
                  <span className="opacity-45">
                    {l.stato === "in-attesa" ? "in coda" : l.stato === "usato" ? "usato" : `fallito: ${l.errore ?? "?"}`}
                  </span>
                  <button onClick={() => rimuoviLink.mutate({ shortcode: l.shortcode })}
                          className="opacity-40 hover:opacity-100" title="togli dalla coda">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Il piano della notte: quale livello vince e perché. È la stessa
          risposta che legge l'agente sul VPS, quindi qui non c'è niente da
          indovinare — si vede prima quello che succederà all'01:00. */}
      {piano.data && (
        <div className="rounded-lg p-3 text-xs" style={{ background: "oklch(0.11 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
          <div className="opacity-55 mb-2">
            {piano.data.scelto
              ? <>Stanotte si parte da <b style={{ color: "oklch(0.8 0.14 145)" }}>{NOMI_LIVELLO[piano.data.scelto]?.label ?? piano.data.scelto}</b> — gli altri livelli restano come ripiego.</>
              : <span style={{ color: "oklch(0.78 0.15 70)" }}>Nessun livello ha materiale: l'agente si fermerà invece di inventare. Carica una reference, incolla un link, o aggiorna la Watchlist.</span>}
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
            {piano.data.livelli.map((l, i) => {
              const vince = piano.data!.scelto === l.livello;
              return (
                <div key={l.livello} className="rounded px-2 py-1.5"
                     style={{
                       background: vince ? "oklch(0.22 0.05 145)" : "transparent",
                       border: `1px solid ${vince ? "oklch(0.45 0.12 145)" : "oklch(0.18 0.015 260)"}`,
                       opacity: l.disponibili > 0 ? 1 : 0.45,
                     }}>
                  <div className="font-medium">
                    {i + 1}. {NOMI_LIVELLO[l.livello]?.label ?? l.livello}
                    <span className="opacity-50 font-normal"> · {l.disponibili}</span>
                  </div>
                  <div className="opacity-50 leading-snug">{l.dettaglio}</div>
                </div>
              );
            })}
          </div>

          {/* Il registro delle reference della cartella, in una riga: una
              reference usata resta impegnata finché non giudichi la bozza che
              ne è nata. Approvi → consumata; scarti → torna libera. */}
          {cartella.data && (
            <div className="mt-2 pt-2 opacity-55" style={{ borderTop: "1px solid oklch(0.18 0.015 260)" }}>
              Cartella del PC: <b>{cartella.data.disponibili}</b> libere ·{" "}
              {cartella.data.inProva} in attesa del tuo giudizio · {cartella.data.approvate} già approvate.
              {" "}Sincronizzata il{" "}
              {new Date(cartella.data.aggiornatoIl).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}.
              {" "}In questa fase di test i file restano dove sono: nessuno viene spostato.
            </div>
          )}
        </div>
      )}

      {/* L'anteprima della Watchlist si mostra solo quando la Watchlist e' davvero
          la fonte di stanotte. Farla vedere mentre vince la cartella del PC
          direbbe una cosa falsa: "stanotte partira' da questi post" quando
          stanotte partira' da altro. */}
      {(modo === "profilo" || piano.data?.scelto === "watchlist") && (
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
                {modo === "profilo"
                  ? `Stanotte partirà da questi ${anteprima.data.length} post del profilo:`
                  : `Ultimo ripiego: nessun livello sopra ha materiale, quindi stanotte si parte da questi ${anteprima.data.length} post della Watchlist:`}
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

/* ------------------------------------------------------------------ */
/* Automazione notturna: interruttore + orario.                        */
/*                                                                     */
/* Nasce da una notte persa (23/08/2026): il job serale delle 23:00 si */
/* era mangiato la finestra Claude da 5 ore, e all'01:00 il Social     */
/* Media Manager ha trovato il serbatoio vuoto — tre tentativi, zero   */
/* bozze. Spostare l'ora voleva dire aprire il crontab del VPS via     */
/* ssh. Da qui questi due comandi: si sposta la notte, o la si spegne, */
/* senza toccare il server.                                            */
/* ------------------------------------------------------------------ */

function AutomazioneNotturna() {
  const config = trpc.social.config.useQuery();
  const [orario, setOrario] = useState("01:00");

  // L'input segue il server finche' Andrea non ci mette le mani: dopo il primo
  // salvataggio il refetch riporta il valore vero e i due restano allineati.
  useEffect(() => { if (config.data?.nightlyRunAt) setOrario(config.data.nightlyRunAt); }, [config.data?.nightlyRunAt]);

  const salva = trpc.settings.set.useMutation({
    onSuccess: () => config.refetch(),
    onError: (e) => toast.error(e.message),
  });

  const attiva = config.data?.nightlyEnabled ?? true;
  const inCorso = salva.isPending || config.isLoading;

  const cambiaInterruttore = (v: boolean) => {
    salva.mutate({ key: "social_nightly_enabled", value: v ? "true" : "false" });
    toast.success(v ? `Automazione accesa — riparte alle ${orario}` : "Automazione spenta: stanotte nessuna bozza");
  };

  const cambiaOrario = (v: string) => {
    setOrario(v);
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(v)) return;   // input a meta' digitazione: si aspetta
    salva.mutate({ key: "social_nightly_run_at", value: v });
    toast.success(`Da stanotte l'agente parte alle ${v}`);
  };

  return (
    <div className="rounded-xl p-4 space-y-3" style={CARD}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            {attiva ? <Moon className="w-4 h-4 opacity-70" /> : <PowerOff className="w-4 h-4 opacity-70" />}
            Automazione notturna
          </h2>
          <p className="text-xs opacity-55 mt-0.5">
            {attiva
              ? "Il Social Media Manager gira ogni notte e lascia qui le bozze. Sposta l'ora o spegnilo quando vuoi."
              : "Spenta. Stanotte non verra' scritta nessuna bozza, finche' non la riaccendi."}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs opacity-60">{attiva ? "Accesa" : "Spenta"}</span>
          <Switch checked={attiva} disabled={inCorso} onCheckedChange={cambiaInterruttore} />
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap pt-1"
           style={{ borderTop: "1px solid oklch(0.2 0.015 260)" }}>
        <label htmlFor="orario-notte" className="text-xs opacity-60 flex items-center gap-1.5 pt-3">
          <Clock className="w-3.5 h-3.5" /> Ora di partenza
        </label>
        <input
          id="orario-notte"
          type="time"
          value={orario}
          disabled={!attiva || inCorso}
          onChange={(e) => cambiaOrario(e.target.value)}
          className="mt-3 rounded-lg px-3 py-1.5 text-sm tabular-nums outline-none disabled:opacity-40"
          style={{ background: "oklch(0.18 0.015 260)", border: "1px solid oklch(0.24 0.015 260)", colorScheme: "dark" }}
        />
        <span className="text-[11px] opacity-45 mt-3">
          {attiva ? `prossima notte alle ${orario}` : "nessuna partenza programmata"}
        </span>
      </div>
    </div>
  );
}

export default function SocialDrafts() {
  const utils = trpc.useUtils();
  const drafts = trpc.social.draftsList.useQuery(undefined, { refetchInterval: 8000 });
  const update = trpc.social.draftUpdate.useMutation({ onSuccess: () => utils.social.draftsList.invalidate() });
  const del = trpc.social.draftDelete.useMutation({ onSuccess: () => utils.social.draftsList.invalidate() });

  type Draft = NonNullable<typeof drafts.data>[number];
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<{ title: string; caption: string; hashtags: string }>({ title: "", caption: "", hashtags: "" });

  const tutte: Draft[] = drafts.data ?? [];

  // Le notti in cui l'agente ha davvero prodotto qualcosa, dalla piu' recente.
  const notti = useMemo(() => {
    const s = new Set<string>();
    for (const d of tutte) if (d.createdAt) s.add(ISO(new Date(d.createdAt as unknown as string)));
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [tutte]);

  const [notte, setNotte] = useState<string | undefined>(undefined);
  // Di default si apre sull'ultima notte prodotta, non su tutto l'archivio.
  useEffect(() => { if (!notte && notti.length) setNotte(notti[0]); }, [notti, notte]);

  const list: Draft[] = notte && notte !== "tutte"
    ? tutte.filter((d) => d.createdAt && ISO(new Date(d.createdAt as unknown as string)) === notte)
    : tutte;
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


      <AutomazioneNotturna />

      <MaterialeNotteSocial />

      <div className="flex items-center gap-3 flex-wrap">
        <SelettoreNotte disponibili={notti} valore={notte} onChange={setNotte} />
        <span className="text-xs opacity-45">
          {list.length} bozze in questa notte · {tutte.length} in archivio
        </span>
      </div>

      {list.length === 0 && (
        <div className="rounded-2xl p-10 text-center text-sm text-muted-foreground" style={{ background: "oklch(0.13 0.015 260)", border: "1px dashed oklch(0.22 0.015 260)" }}>
          {tutte.length === 0 ? (
            <>Nessuna bozza ancora. Genera contenuti da <b>Crea Post</b> o lascia lavorare l'AI Manager: le bozze appariranno qui. ✨</>
          ) : (
            <>
              Nessuna bozza per <b>{etichettaData(notte)}</b>.
              <div className="mt-2 opacity-70">
                O l'automazione non ha girato quella notte, o la critica ha bocciato
                il batch prima che arrivasse qui. L'ultima notte con bozze e'
                {" "}<button className="underline underline-offset-2" onClick={() => setNotte(notti[0])}>
                  {etichettaData(notti[0])}
                </button>.
              </div>
            </>
          )}
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

              {!editing && <ImmagineBozza id={d.id} />}

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
