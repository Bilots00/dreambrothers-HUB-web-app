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
  automazione: { acceso: boolean; dal: string | null; motivo: string | null; da?: string } | null;
  obiettivo: { attivo: boolean; tipo?: "pct" | "importo"; ritorno_pct: number; importo?: number | null; orizzonte_giorni: number; equity_partenza: number; dal: string; nota: string | null } | null;
  progresso_obiettivo: {
    valore_obiettivo: number; tipo?: "pct" | "importo"; importo_obiettivo?: number; importo_effettivo?: number; ritorno_pct: number; orizzonte_giorni: number;
    giorni_passati: number; giorni_rimasti: number; atteso_pct: number; effettivo_pct: number;
    scarto_pct: number; completamento_pct: number | null; passo: "avanti" | "in linea" | "indietro";
    scaduto: boolean; dal: string;
  } | null;
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

/**
 * Il verdetto: chi sta davanti, fra i due agenti e il non fare niente.
 *
 * Due regole, e sono entrambe richieste di Andrea diventate codice:
 *  - un agente SPENTO non partecipa. Confrontare una curva ferma con una che opera non
 *    misura niente: l'agente spento non e' "il trader prudente", e' un trader assente.
 *    Resta visibile come escluso, con il motivo, perche' sparire e' peggio che perdere.
 *  - il buy & hold e' sempre in gara. E' l'unico concorrente che non si puo' spegnere,
 *    ed e' il motivo per cui esiste tutto il resto.
 *
 * Il benchmark si prende dal libro attivo con la storia piu' lunga: e' l'unico che ha
 * osservato tutto il periodo. Se i due libri sono partiti in giorni diversi la
 * differenza si dichiara, invece di far finta che le curve siano confrontabili al centesimo.
 */
export type Concorrente = {
  chiave: string; nome: string; tipo: "agente" | "benchmark";
  ritorno_pct: number | null; equity: number | null; operazioni: number | null;
  attivo: boolean; escluso_perche: string | null;
};

export function verdetto(letture: LetturaLibro[]): {
  classifica: Concorrente[]; esclusi: Concorrente[];
  vincitore: Concorrente | null; batte_il_non_fare_niente: boolean | null;
  campione_sufficiente: boolean; nota: string;
} {
  const buone = letture.filter((l): l is Extract<LetturaLibro, { ok: true }> => l.ok);
  const nome = (k: string) => (k === "principale" ? "Trader COT" : "Trader intraday");

  const agenti: Concorrente[] = buone.map((l) => {
    const acceso = l.dati.automazione?.acceso !== false;
    return {
      chiave: l.libro, nome: nome(l.libro), tipo: "agente" as const,
      ritorno_pct: l.dati.ritorno_pct, equity: l.dati.equity, operazioni: l.dati.metriche.operazioni,
      attivo: acceso, escluso_perche: acceso ? null : "automazione spenta: non sta operando, quindi non gareggia",
    };
  });

  const attivi = agenti.filter((a) => a.attivo);
  // Il benchmark del libro attivo che osserva da piu' tempo; se nessuno e' attivo, quello
  // con la storia piu' lunga fra tutti, cosi' il confronto non sparisce del tutto.
  const fonte = (attivi.length ? buone.filter((l) => attivi.some((a) => a.chiave === l.libro)) : buone)
    .slice()
    .sort((a, b) => (b.dati.metriche.giorni_operativi ?? 0) - (a.dati.metriche.giorni_operativi ?? 0))[0];
  const bench: Concorrente | null = fonte
    ? {
        chiave: "btc", nome: "BTC buy & hold", tipo: "benchmark",
        ritorno_pct: fonte.dati.benchmark_btc?.ritorno_pct ?? null,
        equity: fonte.dati.benchmark_btc?.valore ?? null, operazioni: null,
        attivo: true, escluso_perche: null,
      }
    : null;

  const inGara = [...attivi, ...(bench && bench.ritorno_pct != null ? [bench] : [])]
    .filter((c) => c.ritorno_pct != null)
    .sort((a, b) => (b.ritorno_pct ?? 0) - (a.ritorno_pct ?? 0));

  const vincitore = inGara[0] ?? null;
  const benchPct = bench?.ritorno_pct ?? null;
  const migliorAgente = attivi.filter((a) => a.ritorno_pct != null).sort((a, b) => (b.ritorno_pct ?? 0) - (a.ritorno_pct ?? 0))[0] ?? null;
  const batte = migliorAgente?.ritorno_pct != null && benchPct != null ? migliorAgente.ritorno_pct > benchPct : null;

  // Con poche operazioni chiuse la classifica esiste ma non significa: e' rumore ordinato.
  const opTot = attivi.reduce((s, a) => s + (a.operazioni ?? 0), 0);
  const giorni = Math.max(0, ...buone.map((l) => l.dati.metriche.giorni_operativi ?? 0));
  const nota = !attivi.length
    ? "Nessun agente acceso: in gara c'e' solo il buy & hold, che vince per abbandono."
    : opTot < 30
      ? `Verdetto provvisorio: ${opTot} operazioni chiuse in ${giorni.toFixed(0)} giorni. Sotto le 30 la classifica e' rumore ordinato, non un risultato.`
      : `Verdetto su ${opTot} operazioni chiuse in ${giorni.toFixed(0)} giorni: comincia a voler dire qualcosa.`;

  return {
    classifica: inGara, esclusi: agenti.filter((a) => !a.attivo),
    vincitore, batte_il_non_fare_niente: batte, campione_sufficiente: opTot >= 30, nota,
  };
}

/* ------------------------------------------------------------------ */
/* Comandi verso il VPS: accendi/spegni e obiettivo                     */
/* ------------------------------------------------------------------ */

export type Comando = { azione: "accendi" | "spegni"; motivo?: string } | { obiettivo: { attivo?: boolean; ritorno_pct?: number; importo?: number; orizzonte_giorni?: number; nota?: string } };

/**
 * Scrive sul VPS. Il segreto dei comandi e' DIVERSO da quello di lettura ed esiste solo
 * qui e in ~/.trader.env: chi conoscesse l'indirizzo della dashboard potrebbe leggere,
 * non comandare. Dopo un comando la cache locale va buttata, altrimenti per un minuto la
 * pagina continuerebbe a mostrare lo stato vecchio e sembrerebbe che il bottone non funzioni.
 */
export async function inviaComando(libro: LibroId, comando: Comando, opts: { fetchFn?: typeof fetch } = {}): Promise<{ ok: true; esito: unknown } | { ok: false; motivo: string }> {
  const base = (process.env.TRADER_DASH_BASE ?? "").replace(/\/+$/, "");
  const segreto = process.env.TRADER_DASH_SECRET ?? "";
  const comandoSegreto = process.env.TRADER_COMANDO_SECRET ?? "";
  if (!base || !segreto) return { ok: false, motivo: "TRADER_DASH_BASE / TRADER_DASH_SECRET non configurati" };
  if (!comandoSegreto) return { ok: false, motivo: "TRADER_COMANDO_SECRET non configurato: senza quello i comandi sono disabilitati" };
  const percorso = libro === "principale" ? "trader" : `trader-${libro}`;
  const f = opts.fetchFn ?? fetch;
  try {
    const r = await f(`${base}/${percorso}/${segreto}/comando`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-trader-comando": comandoSegreto },
      body: JSON.stringify(comando),
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await r.json().catch(() => ({}))) as { errore?: string };
    if (!r.ok) return { ok: false, motivo: j.errore || `il VPS ha risposto HTTP ${r.status}` };
    cache.delete(libro);
    return { ok: true, esito: j };
  } catch (err) {
    return { ok: false, motivo: `VPS irraggiungibile: ${err instanceof Error ? err.message : String(err)}` };
  }
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
    automazione: d.automazione ?? { acceso: true, dal: null, motivo: null },
    obiettivo: d.obiettivo ?? null,
    progresso: d.progresso_obiettivo ?? null,
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
