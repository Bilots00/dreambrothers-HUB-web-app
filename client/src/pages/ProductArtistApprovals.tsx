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

export default function ProductArtistApprovals() {
  const [dataSel, setDataSel] = useState<string | undefined>(undefined);

  const batches = trpc.productArtist.batches.useQuery();
  const batch = trpc.productArtist.batch.useQuery({ data: dataSel }, { refetchOnWindowFocus: false });
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

        {nascostiN > 0 && (
          <button
            onClick={() => setMostraScartati(v => !v)}
            className="text-xs opacity-60 hover:opacity-100 underline underline-offset-2 transition-opacity"
          >
            {mostraScartati ? "nascondi gli scartati" : `mostra i ${nascostiN} scartati`}
          </button>
        )}

        {inAttesa.length > 0 && dataSel && (
          <div className="ml-auto flex gap-2">
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

              <div className="flex gap-2 mt-auto">
                <Button
                  size="sm" className="flex-1" disabled={bloccato || d.decisione === "approvato"}
                  onClick={() => decidi.mutate({ data: batch.data!.data, id: d.id, decisione: "approvato" })}
                >
                  <Check className="w-4 h-4 mr-1" /> Approva
                </Button>
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
