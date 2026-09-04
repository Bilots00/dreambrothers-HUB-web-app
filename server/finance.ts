/**
 * Finance: i due agenti trader del fondo personale, letti dal VPS.
 *
 * La web app qui NON calcola e NON decide niente. E' la regola della guida
 * TradingLab (Castagna): i numeri li produce il ciclo sul VPS, la pagina li
 * mostra. Ogni libro pubblica un'istantanea JSON (`dati.json`) accanto alla sua
 * pagina per il telefono, dietro lo stesso segreto nell'indirizzo; il server
 * Railway la legge, la tiene un minuto in cache e la passa alla UI.
 *
 * Due cose che sembrano dettagli e non lo sono:
 *  - se un dato manca si dice che manca (null), mai uno zero: "0 operazioni,
 *    0% win rate" e' una bugia quando in realta' il VPS non ha risposto;
 *  - i due libri sono agenti SEPARATI, con conti separati: qui non si sommano.
 *    Stanno fianco a fianco proprio per essere confrontati.
 */

export type LibroId = "principale" | "intraday";
export const LIBRI: LibroId[] = ["principale", "intraday"];

export type PuntoEquity = { t: string; equity: number };
export type PuntoBenchmark = { t: string; valore: number | null };

export type Istantanea = {
  libro: string;
  generato_il: string;
  modalita: string;
  venue: string;
  capitale_iniziale: number;
  equity: number;
  ritorno_pct: number;
  benchmark_btc: { valore: number | null; ritorno_pct: number | null; serie: PuntoBenchmark[] };
  metriche: {
    operazioni: number; vincenti: number; perdenti: number;
    win_rate_pct: number | null; media_vincita: number | null; media_perdita: number | null;
    profit_factor: number | null; expectancy_r: number | null; max_drawdown_pct: number;
    equity: number; ritorno_totale_pct: number; giorni_operativi: number;
    fee_totali: number; funding_totale: number;
  };
  statistiche: {
    per_setup?: Record<string, unknown>; per_coin?: Record<string, unknown>;
    per_motivo_uscita?: Record<string, unknown>; durata_media_ore: number | null;
    perdite_consecutive_max: number; rifiuti_risk_manager?: { totale: number; motivi: Record<string, number> };
  } | null;
  posizioni: Array<{
    coin: string; lato: 1 | -1; size: number; entrata: number; stop: number | null; target: number | null;
    leva: number | null; pnl_aperto?: number; aperta_il: string | null; setup?: string | null; tesi?: string | null;
  }>;
  chiuse: Array<{
    coin: string; lato: 1 | -1; size?: number; entrata: number; uscita: number; pnl_netto: number;
    fee_pagate?: number; r_multiplo: number | null; aperta_il: string | null; chiusa_il: string;
    setup?: string | null; motivo?: string | null; tesi?: string | null;
  }>;
  equity_storia: PuntoEquity[];
  performance_giornaliera: Array<{ giorno: string; pct: number | null }>;
  heartbeat: { t: string; fase?: string; motivo?: string } | null;
  ultima_decisione: { ora?: string; modello?: string; regime?: string; nota?: string; decisioni?: Array<{ coin: string; azione: string; setup?: string; confidenza?: number; tesi?: string }> } | null;
  circuit_breaker: { motivo: string; fino_a: string } | null;
  broker: Record<string, unknown> | null;
  copia: unknown;
  rischio: { per_operazione_pct: number; leva_max: number; posizioni_max: number; perdita_max_giorno_pct: number; perdita_max_mese_pct: number } | null;
  esperimento: { ipotesi?: string; condizione_di_spegnimento?: string } | null;
};

export type LetturaLibro =
  | { ok: true; libro: LibroId; dati: Istantanea; letto_il: string }
  | { ok: false; libro: LibroId; motivo: string };

/* ------------------------------------------------------------------ */
/* Funzioni pure: sono quelle che i test tengono ferme                 */
/* ------------------------------------------------------------------ */

/**
 * L'etichetta che vale piu' del win rate (TradingLab 7.5): quante operazioni
 * chiuse servono prima che un numero cominci a voler dire qualcosa. Sotto 30 non
 * si distingue una strategia da una serie fortunata; e' aritmetica, non prudenza.
 */
export function etichettaCampione(n: number | null | undefined): { livello: "nessuno" | "piccolo" | "indicativo" | "ragionevole"; testo: string } {
  if (!n || n <= 0) return { livello: "nessuno", testo: "nessuna operazione chiusa ancora" };
  if (n < 30) return { livello: "piccolo", testo: `campione troppo piccolo per concludere qualcosa (${n} su 30)` };
  if (n <= 100) return { livello: "indicativo", testo: `indicativo, non conclusivo (${n} operazioni)` };
  return { livello: "ragionevole", testo: `campione ragionevole (${n} operazioni)` };
}

/**
 * Il ciclo e' acceso? Si guarda l'ultimo battito scritto dal VPS, non l'orologio
 * del browser: un ciclo morto alle due di notte e uno in cui non e' successo niente
 * mandano lo stesso numero di messaggi, cioe' zero. Il battito e' l'unica differenza.
 * Il libro gira ogni ora: oltre 90 minuti senza battito qualcosa e' fermo.
 */
export function statoCiclo(heartbeat: { t: string } | null | undefined, ora = Date.now(), sogliaMin = 90): { acceso: boolean | null; minutiFa: number | null; testo: string } {
  if (!heartbeat?.t) return { acceso: null, minutiFa: null, testo: "nessun battito registrato" };
  const ms = ora - Date.parse(heartbeat.t);
  if (!Number.isFinite(ms)) return { acceso: null, minutiFa: null, testo: "battito illeggibile" };
  const minutiFa = Math.max(0, Math.round(ms / 60_000));
  if (minutiFa <= sogliaMin) return { acceso: true, minutiFa, testo: minutiFa < 1 ? "acceso, battito adesso" : `acceso, ultimo battito ${minutiFa} min fa` };
  const ore = Math.round(minutiFa / 60);
  return { acceso: false, minutiFa, testo: ore >= 2 ? `fermo da ${ore} ore` : `fermo da ${minutiFa} min` };
}

/**
 * "Quanto ho guadagnato in piu' del non fare niente": la riga piu' importante di
 * tutta la guida. Un +10% in un mese in cui BTC ha fatto +40% e' una perdita del 30%
 * travestita da guadagno. Se manca uno dei due numeri non c'e' confronto: null.
 */
export function differenzaDalBenchmark(ritornoPct: number | null | undefined, benchmarkPct: number | null | undefined): number | null {
  if (ritornoPct == null || benchmarkPct == null) return null;
  return Number((ritornoPct - benchmarkPct).toFixed(2));
}

/**
 * Miglior e peggior operazione in percentuale SUL CAPITALE del libro, come nella
 * dashboard del video. Non sul nozionale: con la leva il nozionale gonfia il
 * denominatore e fa sembrare piccola una perdita che sul conto non lo e'.
 */
export function estremiTrade(chiuse: Array<{ pnl_netto: number; coin?: string; chiusa_il?: string }> | undefined, capitale: number): { miglior_pct: number | null; peggior_pct: number | null; miglior?: { coin?: string; chiusa_il?: string }; peggior?: { coin?: string; chiusa_il?: string } } {
  if (!chiuse?.length || !(capitale > 0)) return { miglior_pct: null, peggior_pct: null };
  let mig = chiuse[0], peg = chiuse[0];
  for (const c of chiuse) { if (c.pnl_netto > mig.pnl_netto) mig = c; if (c.pnl_netto < peg.pnl_netto) peg = c; }
  const pct = (c: { pnl_netto: number }) => Number((c.pnl_netto / capitale * 100).toFixed(2));
  return { miglior_pct: pct(mig), peggior_pct: pct(peg), miglior: { coin: mig.coin, chiusa_il: mig.chiusa_il }, peggior: { coin: peg.coin, chiusa_il: peg.chiusa_il } };
}

/** Le due curve sullo stesso asse dei tempi, pronte per il grafico. */
export function curvaUnita(equity: PuntoEquity[] | undefined, benchmark: PuntoBenchmark[] | undefined): Array<{ t: string; portafoglio: number; btc: number | null }> {
  const b = new Map((benchmark ?? []).map((p) => [p.t, p.valore] as const));
  return (equity ?? []).map((p) => ({ t: p.t, portafoglio: p.equity, btc: b.get(p.t) ?? null }));
}

/** Sintesi di un libro per la panoramica: solo quello che serve al confronto. */
export function sintesi(l: LetturaLibro) {
  if (!l.ok) return { libro: l.libro, ok: false as const, motivo: l.motivo };
  const d = l.dati;
  return {
    libro: l.libro, ok: true as const,
    venue: d.venue, modalita: d.modalita,
    capitale_iniziale: d.capitale_iniziale, equity: d.equity, ritorno_pct: d.ritorno_pct,
    benchmark_btc_pct: d.benchmark_btc?.ritorno_pct ?? null,
    differenza_pct: differenzaDalBenchmark(d.ritorno_pct, d.benchmark_btc?.ritorno_pct),
    operazioni: d.metriche.operazioni, win_rate_pct: d.metriche.win_rate_pct,
    expectancy_r: d.metriche.expectancy_r, max_drawdown_pct: d.metriche.max_drawdown_pct,
    posizioni_aperte: d.posizioni.length,
    campione: etichettaCampione(d.metriche.operazioni),
    ciclo: statoCiclo(d.heartbeat),
    generato_il: d.generato_il,
  };
}

/* ------------------------------------------------------------------ */
/* Lettura dal VPS, con cache                                          */
/* ------------------------------------------------------------------ */

const CACHE_MS = 60_000;
const cache = new Map<LibroId, { letto: number; valore: LetturaLibro }>();

function urlLibro(libro: LibroId): string | null {
  const base = (process.env.TRADER_DASH_BASE ?? "").replace(/\/+$/, "");
  const segreto = process.env.TRADER_DASH_SECRET ?? "";
  if (!base || !segreto) return null;
  const percorso = libro === "principale" ? "trader" : `trader-${libro}`;
  return `${base}/${percorso}/${segreto}/dati.json`;
}

export async function leggiLibro(libro: LibroId, opts: { forza?: boolean; fetchFn?: typeof fetch } = {}): Promise<LetturaLibro> {
  const inCache = cache.get(libro);
  if (!opts.forza && inCache && Date.now() - inCache.letto < CACHE_MS) return inCache.valore;

  const url = urlLibro(libro);
  if (!url) return { ok: false, libro, motivo: "TRADER_DASH_BASE / TRADER_DASH_SECRET non configurati su Railway" };

  const f = opts.fetchFn ?? fetch;
  let valore: LetturaLibro;
  try {
    const r = await f(url, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
    if (r.status === 503) valore = { ok: false, libro, motivo: "il VPS non ha ancora generato l'istantanea: aspetta il prossimo giro" };
    else if (!r.ok) valore = { ok: false, libro, motivo: `il VPS ha risposto HTTP ${r.status}` };
    else {
      const dati = (await r.json()) as Istantanea;
      if (!dati || typeof dati.equity !== "number" || !dati.metriche) valore = { ok: false, libro, motivo: "istantanea in un formato inatteso" };
      else valore = { ok: true, libro, dati, letto_il: new Date().toISOString() };
    }
  } catch (err) {
    valore = { ok: false, libro, motivo: `VPS irraggiungibile: ${err instanceof Error ? err.message : String(err)}` };
  }
  // Un errore non deve cancellare l'ultima lettura buona: la si tiene, marcata come vecchia.
  if (!valore.ok && inCache?.valore.ok) {
    const vecchia = inCache.valore;
    cache.set(libro, { letto: Date.now(), valore: vecchia });
    return vecchia;
  }
  cache.set(libro, { letto: Date.now(), valore });
  return valore;
}

export async function leggiTutti(opts: { forza?: boolean } = {}): Promise<LetturaLibro[]> {
  return Promise.all(LIBRI.map((l) => leggiLibro(l, opts)));
}
