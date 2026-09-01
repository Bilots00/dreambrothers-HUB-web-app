/**
 * Approvazione design — la revisione mattutina del Product Artist.
 *
 * L'agente notturno produce i design alle 02:00 e li committa nella sua repo.
 * Qui Andrea dà il sì o il no; l'agente rilegge le decisioni al run successivo,
 * fa partire la catena a valle sugli approvati (Printify, Pinterest, ads) e
 * CANCELLA i file dei rifiutati.
 *
 * Le immagini passano dal server (repo privata, non linkabile dal browser).
 */
import { useEffect, useMemo, useState } from "react";
import {
  Check, X as XIcon, RefreshCw, Loader2, Shirt, Frame,
  CheckCheck, Trash2, Calendar1, ChevronDown, Maximize2, Upload, Sparkles,
  ExternalLink, Megaphone, TriangleAlert, RotateCw, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Decisione = "in_attesa" | "approvato" | "rifiutato";

const DEC_META: Record<Decisione, { label: string; fg: string; bg: string }> = {
  in_attesa: { label: "Da decidere", fg: "oklch(0.82 0.15 90)", bg: "oklch(0.6 0.15 90 / 0.18)" },
  approvato: { label: "Approvato", fg: "oklch(0.8 0.18 150)", bg: "oklch(0.55 0.18 150 / 0.2)" },
  rifiutato: { label: "Rifiutato", fg: "oklch(0.75 0.19 25)", bg: "oklch(0.55 0.2 25 / 0.18)" },
};

const CARD = { background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" };

/* ------------------------------------------------------------------ */
/* Selettore data in stile Shopify: scorciatoie a sinistra, calendario  */
/* a destra. I giorni senza batch non sono cliccabili — l'agente non ha */
/* prodotto nulla quella notte e non c'è niente da mostrare.            */
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

function SelettoreData({
  disponibili, valore, onChange,
}: { disponibili: string[]; valore?: string; onChange: (d: string) => void }) {
  const [aperto, setAperto] = useState(false);
  const [mese, setMese] = useState<Date>(valore ? daISO(valore) : new Date());

  const set = useMemo(() => new Set(disponibili), [disponibili]);
  const conBatch = useMemo(() => disponibili.map(daISO), [disponibili]);

  const scegli = (iso: string) => { onChange(iso); setAperto(false); };

  // Le scorciatoie compaiono solo se esiste davvero un batch per quel giorno.
  const scorciatoie = [
    { label: "Ultimo batch", iso: disponibili[0] },
    { label: "Stanotte", iso: set.has(ISO(new Date())) ? ISO(new Date()) : undefined },
    { label: "Ieri", iso: set.has(ISO(new Date(Date.now() - 86_400_000))) ? ISO(new Date(Date.now() - 86_400_000)) : undefined },
  ].filter(s => s.iso);

  return (
    <Popover open={aperto} onOpenChange={setAperto}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 font-normal">
          <Calendar1 className="w-4 h-4 opacity-70" />
          <span>{etichettaData(valore)}</span>
          <span className="opacity-45 text-xs">{valore}</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-auto p-0" style={CARD}>
        <div className="flex">
          <div className="p-2 flex flex-col gap-0.5 min-w-[150px]"
               style={{ borderRight: "1px solid oklch(0.2 0.015 260)" }}>
            {scorciatoie.map(s => (
              <button
                key={s.label}
                onClick={() => scegli(s.iso!)}
                className="text-left text-sm px-3 py-1.5 rounded-md hover:bg-white/5 transition-colors"
                style={valore === s.iso ? { background: "oklch(0.22 0.02 260)" } : undefined}
              >
                {s.label}
              </button>
            ))}
            <div className="mt-1 pt-2 px-3 text-[11px] opacity-45"
                 style={{ borderTop: "1px solid oklch(0.2 0.015 260)" }}>
              {disponibili.length} notti disponibili
            </div>
          </div>

          <Calendar
            mode="single"
            month={mese}
            onMonthChange={setMese}
            selected={valore ? daISO(valore) : undefined}
            onSelect={(d) => d && set.has(ISO(d)) && scegli(ISO(d))}
            disabled={(d) => !set.has(ISO(d))}
            modifiers={{ conBatch }}
            modifiersStyles={{ conBatch: { fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 3 } }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Materiale per la prossima notte                                     */
/*                                                                     */
/* Le reference si caricano da qui invece che da una cartella sul disco:*/
/* finiscono nella repo dell'agente, che il VPS legge al run notturno.  */
/* Se non carichi niente, l'agente non resta a mani vuote — prende i    */
/* bestseller da un negozio che indichi, o dalla watchlist di Product   */
/* Market FIT.                                                          */
/* ------------------------------------------------------------------ */

const MODI = [
  { id: "caricate", label: "Carico io", desc: "Uso le immagini che carico qui sotto" },
  { id: "url", label: "Da un negozio", desc: "Prendi i bestseller da questa vetrina" },
  { id: "auto", label: "Automatico", desc: "Pesca dai negozi che seguo in Product Market FIT" },
] as const;

/**
 * Carica un design fatto a mano.
 *
 * Nasce il 2026-08-27: i design che Andrea produce da sé — con l'agente su
 * Telegram, con Gemini a mano, in Photoshop — restavano fuori dal flusso e per
 * pubblicarli bisognava passare dalla repo. Da qui entrano nella stessa catena
 * dei design notturni: file di stampa, Printify o Gelato, creatività.
 *
 * Entrano già approvati: se lo carichi tu, la scelta l'hai già fatta.
 */
function CaricaDesign({ data, onFatto }: { data?: string; onFatto: () => void }) {
  const [tipo, setTipo] = useState<"apparel" | "wallart">("apparel");
  const [caricando, setCaricando] = useState(0);

  const carica = trpc.productArtist.caricaDesign.useMutation({
    onError: e => toast.error(e.message),
  });

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setCaricando(files.length);
    let ok = 0;
    for (const file of Array.from(files)) {
      try {
        const base64 = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).split(",")[1] || "");
          r.onerror = rej;
          r.readAsDataURL(file);
        });
        await carica.mutateAsync({ base64, nomeFile: file.name, tipo, data });
        ok++;
      } catch { /* il toast dell'errore l'ha già mostrato onError */ }
    }
    setCaricando(0);
    if (ok) {
      toast.success(ok === 1 ? "Design caricato e approvato" : `${ok} design caricati e approvati`);
      onFatto();
    }
  };

  return (
    <div className="ml-auto flex items-center gap-2">
      <div className="flex rounded-md overflow-hidden text-[11px]"
           style={{ border: "1px solid oklch(0.25 0.02 260)" }}>
        {(["apparel", "wallart"] as const).map(t => (
          <button key={t} onClick={() => setTipo(t)}
            className="px-2 py-1 flex items-center gap-1 transition-colors"
            style={tipo === t
              ? { background: "oklch(0.6 0.15 250 / 0.3)", color: "oklch(0.9 0.05 250)" }
              : { opacity: 0.6 }}>
            {t === "apparel" ? <Shirt className="w-3 h-3" /> : <Frame className="w-3 h-3" />}
            {t === "apparel" ? "capo" : "quadro"}
          </button>
        ))}
      </div>
      <label>
        <Button size="sm" variant="outline" className="gap-1.5 cursor-pointer" asChild disabled={caricando > 0}>
          <span>
            {caricando > 0
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> carico {caricando}…</>
              : <><Upload className="w-3.5 h-3.5" /> carica un design</>}
          </span>
        </Button>
        {/* PNG soltanto: è quello che la catena di stampa sa portare intero
            fino a Printify e Gelato. `capture` assente di proposito: da
            telefono deve poter scegliere dalla galleria, non solo scattare. */}
        <input type="file" accept="image/png" multiple className="hidden"
               onChange={e => { onFiles(e.target.files); e.currentTarget.value = ""; }} />
      </label>
    </div>
  );
}

function MaterialeProssimaNotte() {
  const utils = trpc.useUtils();
  const fonte = trpc.productArtist.fonte.useQuery();
  const reference = trpc.productArtist.reference.useQuery();

  const [modo, setModo] = useState<"caricate" | "url" | "auto">("auto");
  const [url, setUrl] = useState("");
  const [tipo, setTipo] = useState<"apparel" | "wallart">("apparel");
  const [caricando, setCaricando] = useState(0);

  useEffect(() => {
    if (!fonte.data) return;
    setModo(fonte.data.modo);
    setUrl(fonte.data.url ?? "");
  }, [fonte.data]);

  const salva = trpc.productArtist.setFonte.useMutation({
    onSuccess: () => { toast.success("Impostazione salvata per stanotte"); utils.productArtist.fonte.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const carica = trpc.productArtist.caricaReference.useMutation({
    onError: (e) => toast.error(e.message),
  });

  const elimina = trpc.productArtist.eliminaReference.useMutation({
    onSuccess: () => { toast.success("Reference rimossa"); utils.productArtist.reference.invalidate(); },
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
      setCaricando(n => n - 1);
    }
    if (ok) {
      toast.success(`${ok} reference caricate`);
      utils.productArtist.reference.invalidate();
      // Caricare implica volerle usare: si allinea il modo senza farglielo ricordare.
      if (modo !== "caricate") salva.mutate({ modo: "caricate" });
    }
  };

  const files = reference.data ?? [];
  const perTipo = (t: string) => files.filter(f => f.tipo === t);

  return (
    <div className="rounded-xl p-4 space-y-4" style={CARD}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 opacity-70" /> Materiale per la prossima notte
          </h2>
          <p className="text-xs opacity-55 mt-0.5">
            Da cosa deve partire l'agente alle 02:00. Non serve tenere niente sul disco.
          </p>
        </div>
        {fonte.data?.aggiornatoIl && (
          <span className="text-[11px] opacity-45">
            impostato il {new Date(fonte.data.aggiornatoIl).toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        {MODI.map(m => {
          const attivo = modo === m.id;
          return (
            <button
              key={m.id}
              onClick={() => { setModo(m.id); if (m.id !== "url") salva.mutate({ modo: m.id }); }}
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

      {modo === "url" && (
        <div className="flex gap-2 flex-wrap items-center">
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://gernucci.com"
            className="flex-1 min-w-[240px] bg-transparent text-sm rounded-lg px-3 py-2 outline-none"
            style={{ border: "1px solid oklch(0.25 0.015 260)" }}
          />
          <Button size="sm" disabled={salva.isPending || !url.trim()}
                  onClick={() => salva.mutate({ modo: "url", url })}>
            Salva negozio
          </Button>
          <p className="w-full text-[11px] opacity-50">
            L'agente aprirà <code>/collections/all?sort_by=best-selling</code> e userà i primi prodotti come reference.
            Funziona con qualunque store Shopify.
          </p>
        </div>
      )}

      {modo === "auto" && (
        <p className="text-xs opacity-60">
          {fonte.data?.watchlist?.length
            ? <>Userà i bestseller di <b>{fonte.data.watchlist.length} negozi</b> della tua watchlist: {fonte.data.watchlist.join(", ")}</>
            : "Salva questa modalità per agganciare i negozi che segui in Product Market FIT."}
        </p>
      )}

      <div className="pt-1" style={{ borderTop: "1px solid oklch(0.2 0.015 260)" }}>
        <div className="flex items-center gap-2 flex-wrap pt-3">
          <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid oklch(0.25 0.015 260)" }}>
            {(["apparel", "wallart"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTipo(t)}
                className="px-3 py-1.5 text-xs transition-colors"
                style={{ background: tipo === t ? "oklch(0.25 0.06 250)" : "transparent" }}
              >
                {t === "apparel" ? "abbigliamento" : "wall art"}
              </button>
            ))}
          </div>

          <label className="cursor-pointer">
            <input type="file" accept="image/*" multiple className="hidden"
                   onChange={e => { onFiles(e.target.files); e.currentTarget.value = ""; }} />
            <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors hover:bg-white/5"
                  style={{ border: "1px solid oklch(0.25 0.015 260)" }}>
              {caricando > 0 ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {caricando > 0 ? `carico ${caricando}…` : "Carica reference"}
            </span>
          </label>

          <span className="text-[11px] opacity-45">
            {files.length ? `${perTipo("apparel").length} abbigliamento · ${perTipo("wallart").length} wall art` : "nessuna reference caricata per oggi"}
          </span>
        </div>

        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {files.map(f => (
              <span key={f.path}
                    className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md"
                    style={{ background: "oklch(0.11 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" }}>
                <span className="opacity-45">{f.tipo === "apparel" ? "👕" : "🖼"}</span>
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

/** Anteprima a tutto schermo: un design si giudica in grande, non in un francobollo. */
function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 cursor-zoom-out"
      style={{ background: "oklch(0.08 0.01 260 / 0.94)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 p-2 rounded-lg hover:bg-white/10 transition-colors"
        onClick={onClose}
        aria-label="Chiudi"
      >
        <XIcon className="w-5 h-5" />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full object-contain rounded-lg cursor-default"
        onClick={(e) => e.stopPropagation()}
      />
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs opacity-50">
        clicca fuori o premi Esc per chiudere
      </p>
    </div>
  );
}

/** L'anteprima si carica solo quando la card entra in pagina: 20 PNG da 2 MB
 *  scaricati tutti insieme farebbero attendere un minuto prima di vedere nulla. */
function Anteprima({ data, file, alt }: { data: string; file: string; alt: string }) {
  const [aperta, setAperta] = useState(false);
  const q = trpc.productArtist.immagine.useQuery(
    { data, file },
    { staleTime: 60 * 60_000, refetchOnWindowFocus: false },
  );

  if (q.isLoading) {
    return (
      <div className="w-full aspect-square rounded-lg flex items-center justify-center"
           style={{ background: "oklch(0.11 0.015 260)" }}>
        <Loader2 className="w-5 h-5 animate-spin opacity-40" />
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="w-full aspect-square rounded-lg flex items-center justify-center text-xs opacity-50"
           style={{ background: "oklch(0.11 0.015 260)" }}>
        anteprima non disponibile
      </div>
    );
  }
  const src = `data:${q.data.mime};base64,${q.data.base64}`;
  return (
    <>
      <button
        onClick={() => setAperta(true)}
        className="relative w-full group/img cursor-zoom-in"
        title="Apri a tutto schermo"
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="w-full aspect-square object-contain rounded-lg"
          style={{ background: "oklch(0.11 0.015 260)" }}
        />
        <span className="absolute bottom-2 right-2 p-1.5 rounded-md opacity-0 group-hover/img:opacity-100 transition-opacity"
              style={{ background: "oklch(0.1 0.01 260 / 0.8)" }}>
          <Maximize2 className="w-4 h-4" />
        </span>
      </button>
      {aperta && <Lightbox src={src} alt={alt} onClose={() => setAperta(false)} />}
    </>
  );
}

/**
 * Il fronte tipografico che l'agente genera quando la grafica va sul retro.
 *
 * Non si stampa finché non lo si è guardato: è testo inventato dal modello e
 * finisce sul petto del capo, dove si vede più del retro. Il 21/08 è uscito un
 * "RIGHT ON TIME" che col design non c'entrava niente.
 */
function FronteDaApprovare({ data, file, testo, riga2, approvato, onDecidi, onRigenera, inCorso }: {
  data: string;
  file: string;
  testo?: string | null;
  riga2?: string | null;
  approvato?: boolean;
  onDecidi: (ok: boolean) => void;
  onRigenera: (v: {
    testo: string | null;
    riga2: string | null;
    immagine?: { base64: string; nome: string } | null;
  }) => void;
  inCorso: boolean;
}) {
  // Due leve, nessuna scelta da tecnico: le PAROLE e una IMMAGINE di reference.
  // Font, colori e composizione li decide il Product Artist — è lui l'artista
  // (Andrea, 27/08: "non posso fare scelte da professionista, è lui l'artista").
  const [modifica, setModifica] = useState(false);
  const [testo1, setTesto1] = useState(testo || "");
  const [testo2, setTesto2] = useState(riga2 || "");
  const [ref, setRef] = useState<{ base64: string; nome: string; anteprima: string } | null>(null);
  const nome = file.replace(/\.png$/i, "_fronte.png");

  const onFileFronte = (f: File | null) => {
    if (!f) { setRef(null); return; }
    if (f.size > 12 * 1024 * 1024) { toast.error("Immagine troppo grande (max 12 MB)"); return; }
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = String(r.result);
      setRef({ base64: dataUrl.split(",")[1] || "", nome: f.name, anteprima: dataUrl });
    };
    r.readAsDataURL(f);
  };
  const q = trpc.productArtist.immagine.useQuery(
    { data, file: nome },
    { staleTime: 60 * 60_000, refetchOnWindowFocus: false, retry: false },
  );
  // Nessun file: l'upscale non l'ha ancora generato, non c'è niente da decidere.
  if (!q.data) return null;

  const deciso = approvato === true || approvato === false;
  return (
    <div className="space-y-1.5 rounded-lg px-2.5 py-2 text-[11px]"
         style={{ background: "oklch(0.6 0.15 250 / 0.12)", color: "oklch(0.82 0.12 250)" }}>
      <div className="flex items-center gap-1.5">
        <Shirt className="w-3 h-3 shrink-0" />
        <span>Fronte generato{testo ? `: "${testo}"` : ""}</span>
      </div>
      <img
        src={`data:${q.data.mime};base64,${q.data.base64}`}
        alt={`fronte di ${file}`}
        className="w-full rounded-md"
        style={{ background: "oklch(0.11 0.015 260)" }}
      />
      {approvato === true ? (
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1"><Check className="w-3 h-3" /> lo stampiamo davanti</span>
          <button className="underline underline-offset-2 hover:opacity-80 disabled:opacity-40"
                  disabled={inCorso} onClick={() => onDecidi(false)}>
            togli
          </button>
        </div>
      ) : (
        /* Niente più "no, solo retro": una maglietta col disegno dietro e nulla
           davanti non è un prodotto (Andrea, 27/08). Le strade sono due: questo
           fronte va bene, oppure se ne scrive un altro. */
        <div className="flex items-center gap-3">
          <button className="underline underline-offset-2 hover:opacity-80 disabled:opacity-40"
                  disabled={inCorso} onClick={() => onDecidi(true)}>
            usa questo fronte
          </button>
          <button className="underline underline-offset-2 hover:opacity-80 disabled:opacity-40 opacity-80"
                  disabled={inCorso} onClick={() => setModifica(m => !m)}>
            {modifica ? "annulla" : "scrivine un altro"}
          </button>
        </div>
      )}

      {modifica && (
        <div className="space-y-1.5 rounded-md p-2"
             style={{ background: "oklch(0.14 0.02 260 / 0.6)" }}>
          <textarea
            value={testo1}
            onChange={e => setTesto1(e.target.value)}
            rows={2}
            maxLength={80}
            placeholder="la frase davanti, es. I MOVE IN SILENCE"
            className="w-full rounded-md px-2 py-1.5 text-[11px] outline-none"
            style={{ background: "oklch(0.11 0.015 260)", color: "oklch(0.92 0.02 260)" }}
          />
          <input
            value={testo2}
            onChange={e => setTesto2(e.target.value)}
            maxLength={120}
            placeholder="seconda riga (facoltativa)"
            className="w-full rounded-md px-2 py-1.5 text-[11px] outline-none"
            style={{ background: "oklch(0.11 0.015 260)", color: "oklch(0.92 0.02 260)" }}
          />
          {/* La reference: il fronte diventa un design generato da questa
              immagine invece che una scritta. */}
          {ref ? (
            <div className="flex items-center gap-2">
              <img src={ref.anteprima} alt="reference del fronte"
                   className="h-10 w-10 rounded object-cover shrink-0" />
              <span className="truncate opacity-80">{ref.nome}</span>
              <button className="underline underline-offset-2 opacity-70 hover:opacity-100 shrink-0"
                      onClick={() => setRef(null)}>
                togli
              </button>
            </div>
          ) : (
            <label className="flex items-center gap-1.5 cursor-pointer opacity-80 hover:opacity-100">
              <Upload className="w-3 h-3 shrink-0" />
              <span className="underline underline-offset-2">allega una reference per il fronte</span>
              <input type="file" accept="image/*" className="hidden"
                     onChange={e => onFileFronte(e.target.files?.[0] || null)} />
            </label>
          )}

          <button
            className="rounded-md px-2.5 py-1 font-medium disabled:opacity-40"
            style={{ background: "oklch(0.6 0.15 250 / 0.35)", color: "oklch(0.92 0.05 250)" }}
            disabled={inCorso || (!testo1.trim() && !ref)}
            onClick={() => {
              onRigenera({
                testo: testo1.trim() || null,
                riga2: testo2.trim() || null,
                immagine: ref ? { base64: ref.base64, nome: ref.nome } : null,
              });
              setModifica(false);
              setRef(null);
            }}
          >
            rifai il fronte
          </button>

          <div className="opacity-70 leading-snug">
            Scrivi la frase, allega una reference, o tutte e due. Al resto — font,
            colori, composizione — pensa il Product Artist. Il fronte nuovo
            compare da solo entro pochi minuti.
          </div>
        </div>
      )}

      {!deciso && !modifica && (
        <div className="opacity-70 leading-snug">
          Il capo aspetta il tuo sì sul fronte prima di andare in stampa.
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Catena a valle: il prodotto su Printify e le creatività per le ads   */
/* ------------------------------------------------------------------ */

type FileStampa = { tag: string; nome: string; url: string | null; size: number };

type Veste = "apparel" | "wallart";

type Pubblicazione = {
  stato: "in_corso" | "pubblicato" | "pronto_download" | "errore";
  url?: string | null;
  prezzoDa?: number | null;
  varianti?: number | null;
  errore?: string | null;
  avvisoQualita?: string | null;
  fileStampa?: FileStampa[] | null;
  /** wall art: "manuale" = file da scaricare, "auto" = pubblica da sola */
  modalita?: "manuale" | "auto" | null;
  /** auto: in attesa che il VPS produca i file di stampa */
  attesaFile?: boolean | null;
  /** auto: esito per ogni template Gelato */
  esiti?: { titolo: string; stato: string; errore?: string | null }[] | null;
};

/* ------------------------------------------------------------------ */
/* Wall art: manuale (file da scaricare) o automatica (Gelato+Shopify)  */
/* ------------------------------------------------------------------ */

function ModalitaWallart() {
  const utils = trpc.useUtils();
  const settings = trpc.settings.getAll.useQuery();
  const set = trpc.settings.set.useMutation({
    onSuccess: () => utils.settings.getAll.invalidate(),
    onError: e => toast.error(e.message),
  });
  const modo = settings.data?.["wallart.publishMode"] === "auto" ? "auto" : "manuale";

  const OPZIONI = [
    {
      valore: "manuale",
      titolo: "Manuale",
      testo: "Ti consegno i file (3x4) e (5x7) da scaricare: il prodotto lo crei tu dal Bulk Creator.",
    },
    {
      valore: "auto",
      titolo: "Automatica",
      testo: "Approvare È pubblicare: upscale sul VPS e prodotto creato da solo su Gelato + Shopify. Funziona anche dal telefono, a PC spento.",
    },
  ] as const;

  return (
    <div className="rounded-xl p-3 space-y-2" style={CARD}>
      <div className="flex items-center gap-2 text-sm">
        <Frame className="w-4 h-4 opacity-70" />
        <span className="font-medium">Pubblicazione wall art</span>
        {settings.isLoading && <Loader2 className="w-3 h-3 animate-spin opacity-50" />}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {OPZIONI.map(o => (
          <label
            key={o.valore}
            className="flex items-start gap-2.5 rounded-lg p-2.5 cursor-pointer transition-colors"
            style={{
              background: modo === o.valore ? "oklch(0.2 0.03 265)" : "oklch(0.16 0.012 260)",
              border: modo === o.valore ? "1px solid oklch(0.55 0.12 265)" : "1px solid oklch(0.22 0.015 260)",
            }}
          >
            <input
              type="radio"
              name="wallart-mode"
              className="mt-0.5 accent-[#006fcf]"
              checked={modo === o.valore}
              disabled={set.isPending || settings.isLoading}
              onChange={() => set.mutate({ key: "wallart.publishMode", value: o.valore })}
            />
            <span className="text-xs leading-snug">
              <b className="block text-[13px] mb-0.5">{o.titolo}</b>
              <span className="opacity-70">{o.testo}</span>
            </span>
          </label>
        ))}
      </div>
      {modo === "auto" && (
        <p className="text-[11px] opacity-55 leading-snug">
          Template, prezzi e inventario di riferimento sono quelli salvati nel Bulk Creator: se non l'hai
          mai configurato, aprilo una volta e scegli il template — da lì in poi vale ovunque.
        </p>
      )}
    </div>
  );
}

/** Cosa è successo al prodotto dopo il sì: sta salendo, è online, o è fallito. */
function StatoProdotto({ p, veste, data, file, onRiprova, onRifai, onRiallinea, inCorso }: {
  p: Pubblicazione;
  veste: Veste;
  data: string;
  file: string;
  onRiprova: () => void;
  onRifai: (posizione?: "front" | "back") => void;
  onRiallinea?: () => void;
  inCorso: boolean;
}) {
  const Icona = veste === "apparel" ? Shirt : Frame;
  /* Sull'apparel "rifai" non parte subito: prima chiede dove va la grafica,
     come alla prima pubblicazione. Sulla wall art non c'è niente da scegliere. */
  const [scegliPosizione, setScegliPosizione] = useState(false);
  if (p.stato === "in_corso") {
    return (
      <div className="flex items-center gap-2 text-[11px] rounded-lg px-2.5 py-1.5"
           style={{ background: "oklch(0.6 0.15 250 / 0.15)", color: "oklch(0.8 0.14 250)" }}>
        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
        <Icona className="w-3 h-3 shrink-0" />
        <span>
          {veste === "apparel"
            ? "Sto creando il prodotto su Printify…"
            : p.attesaFile
              ? "Upscale sul VPS in corso… il quadro si pubblica da solo appena i file sono pronti (anche a PC spento)."
              : p.modalita === "auto"
                ? "Creo il prodotto su Gelato e Shopify…"
                : "Preparo i file per il Bulk Creator…"}
        </span>
      </div>
    );
  }

  /* Wall art: non c'e' niente da pubblicare qui. I quadri li stampa Gelato e
     il prodotto lo crea Andrea dal Bulk Creator: quello che serve sono i file
     nei due rapporti del catalogo, pronti da scaricare. */
  if (p.stato === "pronto_download") {
    return (
      <div className="space-y-1.5 rounded-lg px-2.5 py-1.5 text-[11px]"
           style={{ background: DEC_META.approvato.bg, color: DEC_META.approvato.fg }}>
        <div className="flex items-center gap-1.5">
          <Check className="w-3 h-3" /> <Frame className="w-3 h-3" /> Quadro: file pronti per il Bulk Creator
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(p.fileStampa || []).map(f => (
            <a key={f.tag} href={f.url || "#"} download={f.nome}
               className="flex items-center gap-1 rounded-md px-2 py-1 hover:opacity-80"
               style={{ border: "1px solid currentColor" }}>
              <Download className="w-3 h-3" /> {f.tag} · {(f.size / 1048576).toFixed(0)} MB
            </a>
          ))}
        </div>
        {p.avvisoQualita && (
          <div className="flex items-start gap-1.5 opacity-80">
            <TriangleAlert className="w-3 h-3 shrink-0 mt-0.5" />
            <span className="leading-snug">{p.avvisoQualita}</span>
          </div>
        )}
        <button className="underline underline-offset-2 hover:opacity-80 disabled:opacity-40 opacity-70"
                disabled={inCorso} onClick={() => onRifai()}>
          rigenera i link
        </button>
      </div>
    );
  }

  if (p.stato === "errore") {
    return (
      <div className="space-y-1.5 rounded-lg px-2.5 py-1.5 text-[11px]"
           style={{ background: DEC_META.rifiutato.bg, color: DEC_META.rifiutato.fg }}>
        <div className="flex items-start gap-1.5">
          <TriangleAlert className="w-3 h-3 shrink-0 mt-0.5" />
          <span className="leading-snug">{p.errore || "Pubblicazione fallita."}</span>
        </div>
        <button className="underline underline-offset-2 hover:opacity-80 disabled:opacity-40"
                disabled={inCorso} onClick={onRiprova}>
          riprova
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1 rounded-lg px-2.5 py-1.5 text-[11px]"
         style={{ background: DEC_META.approvato.bg, color: DEC_META.approvato.fg }}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Check className="w-3 h-3" /> <Icona className="w-3 h-3" />
          {veste === "apparel" ? "Capo online su Shopify" : "Quadro online su Shopify (via Gelato)"}
          {p.prezzoDa ? ` · da ${(p.prezzoDa / 100).toFixed(2)} €` : ""}
          {p.varianti ? ` · ${p.varianti} varianti` : ""}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {p.url && (
            <a href={p.url} target="_blank" rel="noreferrer"
               className="underline underline-offset-2 hover:opacity-80 flex items-center gap-1">
              Printify <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {/* Riscrive l'artwork sul prodotto che c'e' gia': da preferire a
              "rifai" quando cambia solo il file o il modo di posizionarlo,
              perche' non butta via la listing e la sua storia. */}
          {veste === "apparel" && onRiallinea && (
            <button className="underline underline-offset-2 hover:opacity-80 disabled:opacity-40"
                    disabled={inCorso} onClick={onRiallinea} title="Riscrive l'artwork sul prodotto esistente">
              riallinea
            </button>
          )}
          {/* Serve dopo un fix all'artwork: crea un prodotto NUOVO, il vecchio
              va cancellato a mano su Printify. */}
          <button className="underline underline-offset-2 hover:opacity-80 disabled:opacity-40"
                  disabled={inCorso}
                  onClick={() => (veste === "apparel" ? setScegliPosizione(v => !v) : onRifai())}>
            rifai
          </button>
        </span>
      </div>
      {scegliPosizione && (
        <div className="flex gap-1 text-[10px] pt-0.5">
          {([["front", "fronte"], ["back", "retro"], [undefined, "decide l'agente"]] as const).map(([pos, label]) => (
            <button key={label}
              className="flex-1 rounded px-1 py-0.5 hover:bg-white/10 disabled:opacity-40"
              style={{ background: "oklch(0.24 0.02 260)" }}
              disabled={inCorso}
              onClick={() => { setScegliPosizione(false); onRifai(pos); }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {(p.esiti || []).length > 0 && (
        <div className="space-y-0.5 opacity-80">
          {(p.esiti || []).map((e, i) => (
            <div key={i} className="flex items-start gap-1.5">
              {e.stato === "error" ? <TriangleAlert className="w-3 h-3 shrink-0 mt-0.5" /> : <Check className="w-3 h-3 shrink-0 mt-0.5" />}
              <span className="leading-snug">
                {e.titolo}
                {e.stato === "created_in_background" ? " · in arrivo su Shopify" : ""}
                {e.errore ? ` — ${e.errore}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      {p.avvisoQualita && (
        <div className="flex items-start gap-1.5 opacity-80">
          <TriangleAlert className="w-3 h-3 shrink-0 mt-0.5" />
          <span className="leading-snug">{p.avvisoQualita}</span>
        </div>
      )}
      {veste === "apparel" && <FileDiStampaUsato data={data} file={file} />}
    </div>
  );
}

/**
 * Il file di stampa DAVVERO usato sul capo, dentro la card del design.
 *
 * Nasce il 2026-08-27: dopo una pubblicazione Andrea si e' trovato in bacheca
 * piu' copie dello stesso artwork (sottoprodotti della catena, ora filtrati) e
 * non sapeva piu' QUALE file fosse finito sulla maglietta — compresa una copia
 * scontornata male che sembrava quella buona. Questa anteprima chiude il
 * dubbio alla fonte: quello che vedi qui, su sfondo a scacchi che mostra la
 * trasparenza vera, e' il PNG che Printify ha ricevuto.
 */
function FileDiStampaUsato({ data, file }: { data: string; file: string }) {
  const nome = file.replace(/\.png$/i, "_print.png");
  const q = trpc.productArtist.immagine.useQuery(
    { data, file: nome },
    { staleTime: 60 * 60_000, refetchOnWindowFocus: false, retry: false },
  );
  const [aperto, setAperto] = useState(false);
  if (!q.data) return null;
  const src = `data:${q.data.mime};base64,${q.data.base64}`;
  return (
    <div className="pt-1 space-y-1">
      <div className="opacity-70">File di stampa usato sul capo (la scacchiera e' trasparenza):</div>
      <img
        src={src}
        alt={`file di stampa di ${file}`}
        onClick={() => setAperto(true)}
        className="w-full rounded-md cursor-zoom-in"
        style={{
          // La scacchiera dice la verita' sullo scontorno: un buco nelle
          // lettere qui si vede subito, su un fondo pieno no.
          backgroundImage:
            "linear-gradient(45deg, oklch(0.35 0 0) 25%, transparent 25%, transparent 75%, oklch(0.35 0 0) 75%), " +
            "linear-gradient(45deg, oklch(0.35 0 0) 25%, transparent 25%, transparent 75%, oklch(0.35 0 0) 75%)",
          backgroundColor: "oklch(0.5 0 0)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 8px 8px",
        }}
      />
      {aperto && <Lightbox src={src} alt={`file di stampa di ${file}`} onClose={() => setAperto(false)} />}
    </div>
  );
}

type Creativita = {
  formato: string; hook: string; direzione: string;
  primaryText: string; headline: string; cta: string; razionale: string;
};

type PacchettoCreativo = {
  avatar: string; piattaforma: string; perchePiattaforma: string;
  momento: string; angle: string; creativita: Creativita[];
  noteMediaBuyer: string;
};

type RichiestaCreative = {
  stato: "in_coda" | "pronto" | "errore";
  richiestoIl?: string;
  errore?: string | null;
  pacchetto?: PacchettoCreativo | null;
};

/** Le creatività pronte: si aprono a fisarmonica sotto la card, senza uscire dalla pagina. */
function PannelloCreative({ c }: { c: PacchettoCreativo }) {
  const [aperto, setAperto] = useState(false);
  const [copiato, setCopiato] = useState<string | null>(null);

  const copia = async (testo: string, chiave: string) => {
    await navigator.clipboard.writeText(testo);
    setCopiato(chiave);
    setTimeout(() => setCopiato(null), 1500);
  };

  return (
    <div className="rounded-lg text-[11px]" style={{ background: "oklch(0.17 0.02 285)", border: "1px solid oklch(0.24 0.03 285)" }}>
      <button className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left"
              onClick={() => setAperto(a => !a)}>
        <span className="flex items-center gap-1.5" style={{ color: "oklch(0.82 0.13 300)" }}>
          <Megaphone className="w-3 h-3" />
          {c.creativita.length} creatività · {c.piattaforma}
        </span>
        <ChevronDown className={`w-3 h-3 transition-transform ${aperto ? "rotate-180" : ""}`} />
      </button>

      {aperto && (
        <div className="px-2.5 pb-2.5 space-y-2.5">
          <div className="space-y-1 opacity-70 leading-snug">
            <div><strong>Avatar:</strong> {c.avatar}</div>
            <div><strong>Perché {c.piattaforma}:</strong> {c.perchePiattaforma}</div>
            <div><strong>Momento:</strong> {c.momento}</div>
            <div><strong>Angle:</strong> {c.angle}</div>
          </div>

          {c.creativita.map((cr, i) => (
            <div key={i} className="rounded-md p-2 space-y-1.5"
                 style={{ background: "oklch(0.13 0.015 285)", border: "1px solid oklch(0.22 0.02 285)" }}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium opacity-90">{cr.formato}</span>
                <button className="underline underline-offset-2 opacity-60 hover:opacity-100"
                        onClick={() => copia(
                          `HOOK: ${cr.hook}\n\nPRIMARY TEXT:\n${cr.primaryText}\n\nHEADLINE: ${cr.headline}\nCTA: ${cr.cta}\n\nDIREZIONE:\n${cr.direzione}`,
                          `${i}`,
                        )}>
                  {copiato === `${i}` ? "copiato" : "copia"}
                </button>
              </div>
              <div className="leading-snug"><span className="opacity-50">Hook </span>{cr.hook}</div>
              <div className="leading-snug opacity-80"><span className="opacity-60">Visual </span>{cr.direzione}</div>
              <div className="leading-snug whitespace-pre-wrap">{cr.primaryText}</div>
              <div className="leading-snug opacity-80">
                <span className="opacity-60">Headline </span>{cr.headline} · <span className="opacity-60">CTA </span>{cr.cta}
              </div>
              <div className="leading-snug opacity-50 italic">{cr.razionale}</div>
            </div>
          ))}

          <div className="leading-snug opacity-70 pt-0.5">
            <strong>Per il Media Buyer:</strong> {c.noteMediaBuyer}
          </div>
        </div>
      )}
    </div>
  );
}

/** In coda, pronto o fallito: il lavoro vero lo fa l'agente Claude sul VPS. */
function StatoCreative({ r, onAnnulla, annullando }: {
  r: RichiestaCreative; onAnnulla: () => void; annullando: boolean;
}) {
  if (r.stato === "pronto" && r.pacchetto) return <PannelloCreative c={r.pacchetto} />;

  if (r.stato === "errore") {
    return (
      <div className="flex items-start gap-1.5 text-[11px] rounded-lg px-2.5 py-1.5"
           style={{ background: DEC_META.rifiutato.bg, color: DEC_META.rifiutato.fg }}>
        <TriangleAlert className="w-3 h-3 shrink-0 mt-0.5" />
        <span className="leading-snug">{r.errore || "Il Creative Director non ce l'ha fatta."}</span>
      </div>
    );
  }

  /* Se l'agente sul VPS non gira (cron non ancora installato, macchina giu'),
     la rotellina girerebbe per sempre facendo credere che stia lavorando.
     Dopo un quarto d'ora si dice com'e' e si offre la via d'uscita. */
  const attesaMin = r.richiestoIl
    ? Math.floor((Date.now() - new Date(r.richiestoIl).getTime()) / 60000)
    : 0;
  const fermo = attesaMin >= 15;

  return (
    <div className="space-y-1 text-[11px] rounded-lg px-2.5 py-1.5"
         style={fermo
           ? { background: DEC_META.in_attesa.bg, color: DEC_META.in_attesa.fg }
           : { background: "oklch(0.6 0.15 300 / 0.15)", color: "oklch(0.82 0.13 300)" }}>
      <div className="flex items-center gap-2">
        {fermo ? <TriangleAlert className="w-3 h-3 shrink-0" />
               : <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
        <span className="leading-snug">
          {fermo
            ? `In coda da ${attesaMin} min: l'agente sul VPS non ha ancora risposto.`
            : "In coda per il Creative Director sul VPS"}
        </span>
      </div>
      {fermo && (
        <button className="underline underline-offset-2 hover:opacity-80 disabled:opacity-40"
                disabled={annullando} onClick={onAnnulla}>
          togli dalla coda
        </button>
      )}
    </div>
  );
}

export default function ProductArtistApprovals() {
  const [dataSel, setDataSel] = useState<string | undefined>(undefined);

  const batches = trpc.productArtist.batches.useQuery();
  const batch = trpc.productArtist.batch.useQuery(
    { data: dataSel },
    {
      refetchOnWindowFocus: false,
      // Mentre un prodotto sta salendo su Printify la pagina si aggiorna da sola:
      // la pubblicazione gira in background sul server, non nella richiesta.
      refetchInterval: q =>
        q.state.data?.design?.some(
          d =>
            Object.values(d.pubblicazioni ?? {}).some(p => p?.stato === "in_corso") ||
            d.creative?.stato === "in_coda",
        )
          ? 5000
          : false,
    },
  );
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!dataSel && batches.data?.length) setDataSel(batches.data[0]);
  }, [batches.data, dataSel]);

  const ricarica = () => {
    utils.productArtist.batch.invalidate();
    utils.productArtist.batches.invalidate();
  };

  const decidi = trpc.productArtist.decidi.useMutation({
    onSuccess: (_, vars) => {
      toast.success(
        vars.decisione === "approvato" ? "Design approvato"
          : vars.decisione === "rifiutato" ? "Design scartato"
          : "Decisione annullata",
      );
      ricarica();
    },
    onError: (e) => toast.error(e.message),
  });

  const decidiMolti = trpc.productArtist.decidiMolti.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`${vars.ids.length} design → ${vars.decisione === "approvato" ? "approvati" : "scartati"}`);
      ricarica();
    },
    onError: (e) => toast.error(e.message),
  });

  const riallinea = trpc.productArtist.aggiornaArtwork.useMutation({
    onSuccess: () => { toast.success("Artwork riallineato sul prodotto esistente"); ricarica(); },
    onError: e => toast.error(e.message),
  });

  const decidiFronte = trpc.productArtist.decidiFronte.useMutation({
    onSuccess: () => { toast.success("Fronte aggiornato"); ricarica(); },
    onError: e => toast.error(e.message),
  });

  const rigeneraFronte = trpc.productArtist.rigeneraFronte.useMutation({
    onSuccess: () => {
      toast.success("Fronte da rifare: il file nuovo arriva entro pochi minuti");
      ricarica();
    },
    onError: e => toast.error(e.message),
  });

  const ripubblica = trpc.productArtist.ripubblica.useMutation({
    onSuccess: () => { toast.success("Riprovo la pubblicazione"); ricarica(); },
    onError: e => toast.error(e.message),
  });

  /* Il Creative Director lavora con le schede del Brain davanti e ci mette
     qualche secondo: si aspetta il risultato invece di lanciarlo in background,
     perché qui Andrea ha premuto un pulsante e sta guardando. */
  const [creativeInCorso, setCreativeInCorso] = useState<string | null>(null);
  const creaCreative = trpc.productArtist.creaCreative.useMutation({
    onSuccess: () => { toast.success("In coda per il Creative Director"); ricarica(); },
    onError: e => toast.error(e.message),
    onSettled: () => setCreativeInCorso(null),
  });

  const annullaCreative = trpc.productArtist.annullaCreative.useMutation({
    onSuccess: () => { toast.success("Tolto dalla coda"); ricarica(); },
    onError: e => toast.error(e.message),
  });

  const design = batch.data?.design ?? [];
  const inAttesa = useMemo(() => design.filter(d => d.decisione === "in_attesa"), [design]);
  const conteggi = useMemo(() => ({
    approvati: design.filter(d => d.decisione === "approvato").length,
    rifiutati: design.filter(d => d.decisione === "rifiutato").length,
  }), [design]);

  const inCorso = decidi.isPending || decidiMolti.isPending;

  /* Uno scartato sparisce dalla griglia dopo 30 secondi, per lasciare in vista
     solo ciò che aspetta ancora una decisione. Il conto si basa su `decisoIl`,
     che arriva dal server: così la card resta nascosta anche dopo un ricarico,
     invece di ricomparire come se non avessi mai deciso. */
  const GRAZIA_MS = 30_000;
  const [mostraScartati, setMostraScartati] = useState(false);
  const [ora, setOra] = useState(() => Date.now());

  const restanti = (d: { decisione: string; decisoIl: string | null }) =>
    d.decisione === "rifiutato" && d.decisoIl
      ? Math.max(0, GRAZIA_MS - (ora - new Date(d.decisoIl).getTime()))
      : 0;

  const inGrazia = design.some(d => restanti(d) > 0);

  // Il tick gira solo mentre c'è davvero un conto alla rovescia in corso.
  useEffect(() => {
    if (!inGrazia) return;
    const t = setInterval(() => setOra(Date.now()), 500);
    return () => clearInterval(t);
  }, [inGrazia]);

  const nascosto = (d: { decisione: string; decisoIl: string | null }) =>
    d.decisione === "rifiutato" && d.decisoIl !== null && restanti(d) === 0;

  const visibili = mostraScartati ? design : design.filter(d => !nascosto(d));
  const nascostiN = design.filter(nascosto).length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Approvazione design</h1>
          <p className="text-sm opacity-60 mt-1">
            I design prodotti stanotte dal Product Artist. Quello che approvi diventa prodotto e
            contenuto; quello che scarti viene cancellato dal disco dell'agente.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={ricarica} disabled={batch.isFetching}>
          {batch.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-2">Aggiorna</span>
        </Button>
      </div>

      <MaterialeProssimaNotte />

      <ModalitaWallart />

      {/* Selettore della notte + riepilogo */}
      <div className="flex items-center gap-3 flex-wrap rounded-xl p-3" style={CARD}>
        <SelettoreData
          disponibili={batches.data ?? []}
          valore={dataSel}
          onChange={setDataSel}
        />

        <span className="text-sm opacity-70">
          {design.length} design · <b style={{ color: DEC_META.in_attesa.fg }}>{inAttesa.length} da decidere</b>
          {conteggi.approvati > 0 && <> · <span style={{ color: DEC_META.approvato.fg }}>{conteggi.approvati} approvati</span></>}
          {conteggi.rifiutati > 0 && <> · <span style={{ color: DEC_META.rifiutato.fg }}>{conteggi.rifiutati} scartati</span></>}
        </span>

        <CaricaDesign
          data={dataSel}
          onFatto={() => { utils.productArtist.batch.invalidate(); utils.productArtist.batches.invalidate(); }}
        />

        {nascostiN > 0 && (
          <button
            onClick={() => setMostraScartati(v => !v)}
            className="text-xs opacity-60 hover:opacity-100 underline underline-offset-2 transition-opacity"
          >
            {mostraScartati ? "nascondi gli scartati" : `mostra i ${nascostiN} scartati`}
          </button>
        )}

        {inAttesa.length > 0 && dataSel && (
          <div className="flex gap-2 w-full justify-end">
            <Button
              size="sm" variant="outline" disabled={inCorso}
              onClick={() => decidiMolti.mutate({ data: dataSel, ids: inAttesa.map(d => d.id), decisione: "approvato" })}
            >
              <CheckCheck className="w-4 h-4 mr-1.5" /> Approva i {inAttesa.length} restanti
            </Button>
            <Button
              size="sm" variant="outline" disabled={inCorso}
              onClick={() => {
                if (!confirm(`Scartare ${inAttesa.length} design? I file verranno cancellati dall'agente.`)) return;
                decidiMolti.mutate({ data: dataSel, ids: inAttesa.map(d => d.id), decisione: "rifiutato" });
              }}
            >
              <Trash2 className="w-4 h-4 mr-1.5" /> Scarta i restanti
            </Button>
          </div>
        )}
      </div>

      {batch.isLoading && (
        <div className="flex items-center gap-2 text-sm opacity-60 py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Carico il batch…
        </div>
      )}

      {(batch.isError || batches.isError) && (
        <div className="rounded-xl p-4 text-sm" style={{ ...CARD, borderColor: "oklch(0.4 0.15 25)" }}>
          <b style={{ color: DEC_META.rifiutato.fg }}>Non riesco a leggere la repo dell'agente.</b>
          <p className="mt-1 opacity-80">{batches.error?.message || batch.error?.message}</p>
        </div>
      )}

      {!batch.isLoading && !batches.isError && !batch.isError && !design.length && (
        <div className="rounded-xl p-8 text-center text-sm opacity-60" style={CARD}>
          Nessun design per questa data. L'agente gira ogni notte alle 02:00.
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {visibili.map(d => {
          const meta = DEC_META[d.decisione as Decisione] ?? DEC_META.in_attesa;
          const bloccato = d.applicato || inCorso;
          const msRestanti = restanti(d);
          return (
            <div key={d.id} className="rounded-xl p-3 flex flex-col gap-3 transition-opacity"
                 style={{ ...CARD, opacity: d.decisione === "rifiutato" ? 0.55 : 1 }}>
              <Anteprima data={batch.data!.data} file={d.file} alt={d.concept || d.id} />

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] px-2 py-0.5 rounded-full"
                        style={{ color: meta.fg, background: meta.bg }}>
                    {meta.label}
                  </span>
                  <span className="text-[11px] opacity-60 flex items-center gap-1">
                    {d.tipo === "apparel" ? <Shirt className="w-3 h-3" /> : <Frame className="w-3 h-3" />}
                    {d.tipo === "apparel" ? "abbigliamento" : "wall art"}
                  </span>
                  {d.applicato && <span className="text-[11px] opacity-50">già eseguito</span>}
                </div>

                {d.concept && <p className="text-sm leading-snug">{d.concept}</p>}

                <div className="text-[11px] opacity-55 space-y-0.5">
                  {d.prodotto && <div>{d.prodotto}{d.fornitore ? ` · ${d.fornitore}` : ""}</div>}
                  {d.avatar && <div>avatar: {d.avatar}</div>}
                  {d.testoDaComporre && <div className="italic">testo: {d.testoDaComporre}</div>}
                </div>
              </div>

              {msRestanti > 0 && (
                <div className="flex items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-1.5"
                     style={{ background: DEC_META.rifiutato.bg, color: DEC_META.rifiutato.fg }}>
                  <span>sparisce tra {Math.ceil(msRestanti / 1000)}s</span>
                  <button
                    className="underline underline-offset-2 hover:opacity-80"
                    disabled={inCorso}
                    onClick={() => decidi.mutate({ data: batch.data!.data, id: d.id, decisione: "in_attesa" })}
                  >
                    annulla
                  </button>
                </div>
              )}

              {d.tipo === "apparel" && d.stampa?.posizione === "back" && (
                <FronteDaApprovare
                  data={batch.data!.data}
                  file={d.file}
                  testo={d.stampa?.fronteTesto}
                  riga2={d.stampa?.fronteRiga2}
                  approvato={d.fronteApprovato}
                  inCorso={decidiFronte.isPending || rigeneraFronte.isPending}
                  onDecidi={ok => decidiFronte.mutate({ data: batch.data!.data, id: d.id, ok })}
                  onRigenera={v => rigeneraFronte.mutate({ data: batch.data!.data, id: d.id, ...v })}
                />
              )}

              {(["apparel", "wallart"] as const).map(v => {
                const pub = d.pubblicazioni?.[v];
                if (!pub) return null;
                return (
                  <StatoProdotto
                    data={dataSel!}
                    file={d.file}
                    key={v}
                    veste={v}
                    p={pub}
                    inCorso={ripubblica.isPending || riallinea.isPending}
                    onRiallinea={
                      pub.stato === "pubblicato"
                        ? () => riallinea.mutate({ data: batch.data!.data, id: d.id })
                        : undefined
                    }
                    onRiprova={() => ripubblica.mutate({ data: batch.data!.data, id: d.id, tipo: v })}
                    onRifai={(posizione) => {
                      if (v === "apparel") {
                        const ok = confirm(
                          "Crea un prodotto NUOVO su Printify con l'artwork aggiornato. " +
                            "Quello vecchio resta: va cancellato a mano da Printify. Procedo?",
                        );
                        if (!ok) return;
                      }
                      ripubblica.mutate({ data: batch.data!.data, id: d.id, tipo: v, forza: true, posizione });
                    }}
                  />
                );
              })}

              {/* La stessa grafica vive in due vesti: quadro su Gelato e capo su
                  Printify. Qui compaiono solo le vesti che mancano ancora. */}
              {d.decisione === "approvato" &&
                (!d.pubblicazioni?.apparel || !d.pubblicazioni?.wallart) && (
                <div className="space-y-1.5 text-[11px] rounded-lg px-2.5 py-1.5"
                     style={{ background: "oklch(0.2 0.01 260)" }}>
                  <div className="opacity-70">
                    {d.pubblicazioni?.apparel || d.pubblicazioni?.wallart
                      ? "Pubblica anche come"
                      : "Prodotto non ancora creato · pubblica come"}
                  </div>
                  <div className="flex gap-1.5">
                    {!d.pubblicazioni?.apparel && (
                      /* Fronte, retro, o lascia decidere all'agente: la regola
                         fronte/retro (ancora identitaria davanti, narrativa
                         dietro) la applica lui, ma l'ultima parola resta qui. */
                      <div className="flex-1 rounded-md py-1 px-1.5 space-y-1"
                           style={{ border: "1px solid oklch(0.3 0.02 260)" }}>
                        <div className="flex items-center justify-center gap-1 opacity-90">
                          <Shirt className="w-3 h-3" /> abbigliamento
                        </div>
                        <div className="flex gap-1 text-[10px]">
                          {([["front", "fronte"], ["back", "retro"], [undefined, "decide l'agente"]] as const).map(([pos, label]) => (
                            <button key={label}
                              className="flex-1 rounded px-1 py-0.5 hover:bg-white/10 disabled:opacity-40"
                              style={{ background: "oklch(0.24 0.02 260)" }}
                              disabled={ripubblica.isPending}
                              onClick={() => ripubblica.mutate({ data: batch.data!.data, id: d.id, tipo: "apparel", posizione: pos })}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {!d.pubblicazioni?.wallart && (
                      <button
                        className="flex-1 flex items-center justify-center gap-1 rounded-md py-1 hover:opacity-80 disabled:opacity-40"
                        style={{ border: "1px solid oklch(0.3 0.02 260)" }}
                        disabled={ripubblica.isPending}
                        onClick={() => ripubblica.mutate({ data: batch.data!.data, id: d.id, tipo: "wallart" })}
                      >
                        <Frame className="w-3 h-3" /> wall art
                      </button>
                    )}
                  </div>
                </div>
              )}

              {d.creative && (
                <StatoCreative
                  r={d.creative}
                  annullando={annullaCreative.isPending}
                  onAnnulla={() => annullaCreative.mutate({ data: batch.data!.data, id: d.id })}
                />
              )}

              <div className="flex gap-2 mt-auto">
                {d.decisione === "approvato" ? (
                  /* Approvato: il prodotto è già in viaggio, il passo dopo è
                     promuoverlo. Il pulsante prende il posto di "Approva", che
                     qui non avrebbe più nulla da fare. */
                  <Button
                    size="sm" className="flex-1"
                    disabled={creaCreative.isPending || d.creative?.stato === "in_coda"}
                    onClick={() => {
                      setCreativeInCorso(d.id);
                      creaCreative.mutate({ data: batch.data!.data, id: d.id });
                    }}
                  >
                    {creativeInCorso === d.id && creaCreative.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Metto in coda…</>
                    ) : d.creative?.stato === "in_coda" ? (
                      <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> In coda</>
                    ) : d.creative?.stato === "pronto" ? (
                      <><RotateCw className="w-4 h-4 mr-1" /> Rifai le creatività</>
                    ) : (
                      <><Megaphone className="w-4 h-4 mr-1" /> Crea Creative</>
                    )}
                  </Button>
                ) : (
                  <Button
                    size="sm" className="flex-1" disabled={bloccato}
                    onClick={() => decidi.mutate({ data: batch.data!.data, id: d.id, decisione: "approvato" })}
                  >
                    <Check className="w-4 h-4 mr-1" /> Approva
                  </Button>
                )}
                <Button
                  size="sm" variant="outline" className="flex-1" disabled={bloccato || d.decisione === "rifiutato"}
                  onClick={() => decidi.mutate({ data: batch.data!.data, id: d.id, decisione: "rifiutato" })}
                >
                  <XIcon className="w-4 h-4 mr-1" /> Scarta
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
