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
  Check, X as XIcon, Clock, RefreshCw, Loader2, Shirt, Frame,
  CheckCheck, Trash2, Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Decisione = "in_attesa" | "approvato" | "rifiutato";

const DEC_META: Record<Decisione, { label: string; fg: string; bg: string }> = {
  in_attesa: { label: "Da decidere", fg: "oklch(0.82 0.15 90)", bg: "oklch(0.6 0.15 90 / 0.18)" },
  approvato: { label: "Approvato", fg: "oklch(0.8 0.18 150)", bg: "oklch(0.55 0.18 150 / 0.2)" },
  rifiutato: { label: "Rifiutato", fg: "oklch(0.75 0.19 25)", bg: "oklch(0.55 0.2 25 / 0.18)" },
};

const CARD = { background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.2 0.015 260)" };

/** L'anteprima si carica solo quando la card entra in pagina: 20 PNG da 2 MB
 *  scaricati tutti insieme farebbero attendere un minuto prima di vedere nulla. */
function Anteprima({ data, file, alt }: { data: string; file: string; alt: string }) {
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
  return (
    <img
      src={`data:${q.data.mime};base64,${q.data.base64}`}
      alt={alt}
      loading="lazy"
      className="w-full aspect-square object-contain rounded-lg"
      style={{ background: "oklch(0.11 0.015 260)" }}
    />
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
      toast.success(vars.decisione === "approvato" ? "Design approvato" : "Design scartato");
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

      {/* Selettore della notte + riepilogo */}
      <div className="flex items-center gap-3 flex-wrap rounded-xl p-3" style={CARD}>
        <Calendar className="w-4 h-4 opacity-60" />
        <select
          value={dataSel ?? ""}
          onChange={(e) => setDataSel(e.target.value)}
          className="bg-transparent text-sm outline-none rounded px-2 py-1"
          style={{ border: "1px solid oklch(0.25 0.015 260)" }}
        >
          {(batches.data ?? []).map(d => <option key={d} value={d}>{d}</option>)}
        </select>

        <span className="text-sm opacity-70">
          {design.length} design · <b style={{ color: DEC_META.in_attesa.fg }}>{inAttesa.length} da decidere</b>
          {conteggi.approvati > 0 && <> · <span style={{ color: DEC_META.approvato.fg }}>{conteggi.approvati} approvati</span></>}
          {conteggi.rifiutati > 0 && <> · <span style={{ color: DEC_META.rifiutato.fg }}>{conteggi.rifiutati} scartati</span></>}
        </span>

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
        {design.map(d => {
          const meta = DEC_META[d.decisione as Decisione] ?? DEC_META.in_attesa;
          const bloccato = d.applicato || inCorso;
          return (
            <div key={d.id} className="rounded-xl p-3 flex flex-col gap-3" style={CARD}>
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

              <div className="flex gap-2 mt-auto">
                <Button
                  size="sm" className="flex-1" disabled={bloccato || d.decisione === "approvato"}
                  onClick={() => decidi.mutate({
                    data: batch.data!.data, id: d.id, decisione: "approvato", sha: batch.data!.sha,
                  })}
                >
                  <Check className="w-4 h-4 mr-1" /> Approva
                </Button>
                <Button
                  size="sm" variant="outline" className="flex-1" disabled={bloccato || d.decisione === "rifiutato"}
                  onClick={() => decidi.mutate({
                    data: batch.data!.data, id: d.id, decisione: "rifiutato", sha: batch.data!.sha,
                  })}
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
