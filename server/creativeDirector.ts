/**
 * Creative Director — le creatività pubblicitarie per un prodotto approvato.
 *
 * Il motore NON è un'API a pagamento e non è Gemini: è l'abbonamento Claude Max
 * già pagato, che gira sul VPS con `claude -p`. Vale la stessa regola di casa
 * degli altri agenti (vedi Research Hub, Market Intelligence): la web app non
 * ragiona, mette in coda; l'agente sul VPS pesca, pensa e riconsegna.
 *
 *   web app  →  design.creative = { stato: "in_coda" }
 *   agente   →  GET  /api/creative/pending   (header x-care-secret)
 *   agente   →  claude -p  con la scheda-ruolo e il Brain locali
 *   agente   →  POST /api/creative/result
 *
 * Chi lavora sono i due ruoli già mappati nel Brain: il **Creative Director**
 * (`areas/creatives/_hub-creatives`) e il **Copywriter**
 * (`areas/hr-training/ruoli/copywriter`). La strategia non è un parametro fisso:
 * piattaforma, avatar e angle nascono dall'incrocio fra design, platform matrix
 * e momento dell'anno.
 */

import { getBrandContext } from "./brainClient";

/* ------------------------------------------------------------------ */
/* Forma del risultato                                                 */
/* ------------------------------------------------------------------ */

export type Creativita = {
  /** es. "Reel 9:16", "Statica 1:1", "Carosello 4:5" */
  formato: string;
  /** i primi 3 secondi: è l'unico pezzo che decide se il resto viene visto */
  hook: string;
  /** script scena per scena se è video, direzione visiva se è statica */
  direzione: string;
  primaryText: string;
  headline: string;
  cta: string;
  /** perché questa creatività dovrebbe funzionare su questo avatar */
  razionale: string;
};

export type PacchettoCreativo = {
  generatoIl: string;
  /** avatar scelto: uno solo, mai voci mischiate (regola del Brain) */
  avatar: string;
  piattaforma: string;
  perchePiattaforma: string;
  /** dove siamo nel calendario e cosa cambia di conseguenza */
  momento: string;
  angle: string;
  creativita: Creativita[];
  noteMediaBuyer: string;
};

/** Lo stato della richiesta, come vive dentro il design nel batch. */
export type RichiestaCreative = {
  stato: "in_coda" | "pronto" | "errore";
  richiestoIl: string;
  presoIlCaricoIl?: string;
  errore?: string;
  pacchetto?: PacchettoCreativo;
};

/* ------------------------------------------------------------------ */
/* Il brief che l'agente riceve                                        */
/* ------------------------------------------------------------------ */

/** Il momento dell'anno in chiaro: il modello non ha una data affidabile da solo. */
export function momentoCorrente(): string {
  const ora = new Date();
  const fmt = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const mese = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", month: "2-digit" }).format(ora),
  );
  const stagione =
    mese <= 2 || mese === 12
      ? "inverno — stagione regalo e proposito di inizio anno"
      : mese <= 5
        ? "primavera — rinnovo, 'nuova versione di me'"
        : mese <= 8
          ? "estate — fine stagione, rientro e ripartenza di settembre all'orizzonte"
          : "autunno — rientro, nuova routine, avvicinamento al Q4 e al Black Friday";
  return `${fmt.format(ora)} (${stagione})`;
}

export type BriefCreative = {
  data: string;
  id: string;
  concept: string;
  avatar: string;
  prodotto: string;
  testoDaComporre: string;
  tipo: "apparel" | "wallart";
  mockup?: string | null;
  prezzoDa?: number | null;
  momento: string;
  richiestoIl: string;
};

/** Il contesto brand che accompagna la coda, come per market/pending-enrich. */
export async function contestoPerAgente(): Promise<string> {
  return getBrandContext();
}

/* ------------------------------------------------------------------ */
/* Validazione di ciò che l'agente riconsegna                          */
/* ------------------------------------------------------------------ */

function testo(v: unknown, max = 4000): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Normalizza il pacchetto in arrivo dall'agente.
 *
 * Non ci si fida della forma: `claude -p` restituisce testo, e un campo mancante
 * qui diventerebbe una card rotta nella pagina. Meglio scartare con un errore
 * parlante che salvare mezzo pacchetto.
 */
export function validaPacchetto(grezzo: unknown): PacchettoCreativo {
  const o = (grezzo ?? {}) as Record<string, unknown>;
  const listaGrezza = Array.isArray(o.creativita) ? o.creativita : [];

  const creativita: Creativita[] = listaGrezza
    .map(c => {
      const x = (c ?? {}) as Record<string, unknown>;
      return {
        formato: testo(x.formato, 120),
        hook: testo(x.hook, 600),
        direzione: testo(x.direzione, 3000),
        primaryText: testo(x.primaryText, 3000),
        headline: testo(x.headline, 300),
        cta: testo(x.cta, 120),
        razionale: testo(x.razionale, 1200),
      };
    })
    .filter(c => c.hook && c.primaryText);

  if (!creativita.length) {
    throw new Error("Il pacchetto non contiene creatività utilizzabili (servono almeno hook e primaryText).");
  }

  return {
    generatoIl: new Date().toISOString(),
    avatar: testo(o.avatar, 120),
    piattaforma: testo(o.piattaforma, 120) || "non dichiarata",
    perchePiattaforma: testo(o.perchePiattaforma, 1500),
    momento: testo(o.momento, 600),
    angle: testo(o.angle, 1000),
    creativita,
    noteMediaBuyer: testo(o.noteMediaBuyer, 2000),
  };
}
