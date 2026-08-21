/**
 * Chi stampa questo ordine: Printify o Gelato.
 *
 * L'IDEA
 * La vetrina resta su Printify perche' e' l'unico che mostra un mockup diverso
 * per ogni colore di capo (design chiaro sul nero, scuro sul bianco). La
 * produzione invece va a chi costa meno PER QUELL'ORDINE, che dipende da dove
 * abita il cliente: in Europa vince Gelato di ~5 EUR a maglietta e consegna in
 * 5-6 giorni invece di 8-16, negli Stati Uniti e' un pareggio (12.30 contro
 * 12.28, misurato il 21/08/2026). Migrare tutto sarebbe sbagliato quanto non
 * migrare niente.
 *
 * COME FUNZIONA
 * Arriva il webhook `orders/create` di Shopify → si ricostruisce cosa va
 * stampato → si chiedono due preventivi VERI (non listini) → vince il piu'
 * economico. Se vince Gelato, si crea l'ordine da loro e si ANNULLA quello
 * Printify prima che parta.
 *
 * ⚠️ PRESUPPOSTO CHE VA RISPETTATO SU PRINTIFY
 * Nel pannello Printify il negozio deve avere l'invio in produzione MANUALE
 * ("Order approval" attivo). Con l'invio automatico l'ordine parte in stampa
 * nei secondi in cui questo codice sta ancora chiedendo i preventivi, e ci si
 * ritrova a pagarlo due volte. Se l'annullamento fallisce perche' l'ordine e'
 * gia' in produzione, qui NON si crea l'ordine Gelato: meglio pagarlo caro una
 * volta sola che stamparlo due.
 *
 * IVA E REGIME FORFETTARIO
 * Andrea e' in forfettario: l'IVA non la scarica, quindi e' un costo vero. Ma
 * lo e' su entrambi i fornitori — Gelato la addebita in fattura quando stampa
 * in Italia, Printify fattura in reverse charge e il forfettario deve
 * autoliquidarla lo stesso — quindi si somma in proporzione uguale ai due lati
 * e non cambia chi vince. Per questo il confronto e' al netto: e' il numero che
 * entrambi espongono, ed e' l'unico confrontabile senza inventare aliquote.
 */

import { preventivo, creaOrdine, codiceProdotto, type RigaOrdine, type Destinatario, type FileStampa, type Stampe } from "./gelato";
import { linkArtwork } from "./artworkLink";

const PRINTIFY_API = "https://api.printify.com/v1";
/** Sotto questo risparmio non vale la pena spostare l'ordine: si resta su Printify. */
const SOGLIA_EUR = Number(process.env.FULFILLMENT_SOGLIA_EUR || 0.5);
const EUR_USD = Number(process.env.PRINTIFY_USD_EUR ? 1 / Number(process.env.PRINTIFY_USD_EUR) : 1.16);

/* ------------------------------------------------------------------ */
/* La ricetta di stampa                                                */
/* ------------------------------------------------------------------ */

/**
 * Cosa serve sapere, al momento dell'ordine, per rifare lo stesso capo altrove.
 *
 * Si salva su Shopify come metafield `custom.ricetta_stampa` quando il prodotto
 * viene pubblicato. Si salvano i NOMI dei file, non gli indirizzi: i link
 * all'artwork sono firmati e scadono dopo un'ora, quindi vanno rigenerati al
 * momento (vedi `linkArtwork`).
 */
export type RicettaStampa = {
  /** la data del batch dell'agente: serve a ritrovare i file */
  data: string;
  /** file di stampa principale, quello per i capi scuri */
  scuro: string;
  /** variante con i testi scuriti, per i capi chiari */
  chiaro?: string | null;
  /** tipografia del petto, quando la grafica grande va sul retro */
  fronte?: string | null;
  /** dove va la grafica principale */
  posizione: "front" | "back";
  /** etichetta col logo dentro il collo */
  etichetta?: boolean;
};

/** I capi su cui va stampata la variante CHIARA del design. */
const CAPI_SCURI = ["black", "navy", "charcoal", "dark heather", "forest green", "maroon"];
const eScuro = (colore: string) => CAPI_SCURI.includes(colore.trim().toLowerCase());

/* ------------------------------------------------------------------ */
/* Shopify                                                             */
/* ------------------------------------------------------------------ */

async function shopify<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) throw new Error("Mancano SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN nelle variabili Railway.");
  const r = await fetch(`https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-04"}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(`Shopify: ${JSON.stringify(j.errors).slice(0, 300)}`);
  return j.data as T;
}

export type RigaShopify = { productGid: string; colore: string; taglia: string; quantita: number; titolo: string };

/** Legge la ricetta di stampa dal prodotto. Senza, l'ordine non e' spostabile. */
async function ricetta(productGid: string): Promise<RicettaStampa | null> {
  const d = await shopify<{ product: { metafield: { value: string } | null } | null }>(
    `query($id: ID!){ product(id:$id){ metafield(namespace:"custom", key:"ricetta_stampa"){ value } } }`,
    { id: productGid },
  );
  const raw = d.product?.metafield?.value;
  if (!raw) return null;
  try { return JSON.parse(raw) as RicettaStampa; } catch { return null; }
}

/* ------------------------------------------------------------------ */
/* Printify                                                            */
/* ------------------------------------------------------------------ */

async function printify<T>(pathname: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const t = process.env.PRINTIFY_API_TOKEN;
  if (!t) throw new Error("Manca PRINTIFY_API_TOKEN nelle variabili Railway.");
  const r = await fetch(`${PRINTIFY_API}${pathname}`, {
    method: init?.method || "GET",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", "User-Agent": "DreamBrothers-HUB" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Printify ${r.status} su ${pathname}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

type OrdinePrintify = { id: string; status: string; metadata?: { shop_order_id?: number | string }; total_shipping?: number; line_items?: { cost?: number; quantity?: number }[] };

/** L'ordine Printify nato da questo ordine Shopify, se e' gia' arrivato. */
async function ordinePrintify(shopId: number, numeroShopify: string | number): Promise<OrdinePrintify | null> {
  const d = await printify<{ data?: OrdinePrintify[] }>(`/shops/${shopId}/orders.json?limit=20`);
  return (d.data || []).find(o => String(o.metadata?.shop_order_id) === String(numeroShopify)) || null;
}

/** Quanto costa a noi, in EUR al netto, l'ordine come lo farebbe Printify. */
function costoPrintify(o: OrdinePrintify): number {
  const capi = (o.line_items || []).reduce((n, r) => n + (r.cost || 0), 0);
  return (capi + (o.total_shipping || 0)) / 100 / EUR_USD;
}

/* ------------------------------------------------------------------ */
/* La decisione                                                        */
/* ------------------------------------------------------------------ */

export type Esito = {
  fornitore: "gelato" | "printify";
  motivo: string;
  costoGelato: number | null;
  costoPrintify: number | null;
  risparmio: number | null;
  consegna?: string;
  ordineGelato?: string;
};

/**
 * Costruisce le righe Gelato dall'ordine Shopify.
 *
 * Il file cambia col colore del capo: e' il motivo per cui la vetrina sta su
 * Printify, e va rispettato anche qui, altrimenti si stampa una grafica scura
 * su un capo scuro e il cliente riceve una maglietta con niente sopra.
 */
export async function righeGelato(righe: RigaShopify[]): Promise<RigaOrdine[]> {
  const out: RigaOrdine[] = [];
  for (let i = 0; i < righe.length; i++) {
    const r = righe[i];
    const ric = await ricetta(r.productGid);
    if (!ric) throw new Error(`"${r.titolo}" non ha la ricetta di stampa: non posso rifarlo su Gelato.`);

    const principale = eScuro(r.colore) ? ric.scuro : (ric.chiaro || ric.scuro);
    const urlPrincipale = linkArtwork(ric.data, principale);
    if (!urlPrincipale) throw new Error(`Non riesco a firmare il link per ${principale}.`);

    const file: FileStampa[] = [];
    const stampe: Stampe = { fronte: false, retro: false, etichettaCollo: !!ric.etichetta };
    if (ric.posizione === "back") {
      file.push({ type: "back", url: urlPrincipale });
      stampe.retro = true;
      if (ric.fronte) {
        const u = linkArtwork(ric.data, ric.fronte);
        if (u) { file.push({ type: "front", url: u }); stampe.fronte = true; }
      }
    } else {
      file.push({ type: "front", url: urlPrincipale });
      stampe.fronte = true;
    }
    if (ric.etichetta) {
      const u = process.env.GELATO_ETICHETTA_URL;
      if (!u) throw new Error("Manca GELATO_ETICHETTA_URL: senza, l'etichetta al collo non si puo' stampare su Gelato.");
      file.push({ type: "neck-inner", url: u });
    }

    out.push({
      riferimento: `riga-${i + 1}`,
      codiceProdotto: codiceProdotto(r.colore, r.taglia, stampe),
      file,
      quantita: r.quantita,
    });
  }
  return out;
}

/**
 * Sceglie il fornitore ed esegue. Ritorna sempre un esito leggibile: se
 * qualcosa non torna resta su Printify, che e' lo stato di riposo sicuro.
 */
export async function instrada(input: {
  numeroOrdine: string;
  shopIdPrintify: number;
  righe: RigaShopify[];
  destinatario: Destinatario;
  /** true = calcola e basta, non crea e non annulla niente */
  simula?: boolean;
}): Promise<Esito> {
  const restaSuPrintify = (motivo: string, cg: number | null = null, cp: number | null = null): Esito =>
    ({ fornitore: "printify", motivo, costoGelato: cg, costoPrintify: cp, risparmio: null });

  let righe: RigaOrdine[];
  try { righe = await righeGelato(input.righe); }
  catch (e) { return restaSuPrintify(`Gelato non applicabile: ${e instanceof Error ? e.message : String(e)}`); }

  let prev;
  try { prev = await preventivo(righe, input.destinatario); }
  catch (e) { return restaSuPrintify(`preventivo Gelato fallito: ${e instanceof Error ? e.message : String(e)}`); }

  const ordineP = await ordinePrintify(input.shopIdPrintify, input.numeroOrdine).catch(() => null);
  const costoP = ordineP ? costoPrintify(ordineP) : null;

  if (!ordineP || costoP == null) {
    return restaSuPrintify("l'ordine Printify non e' ancora arrivato: non ho un costo da battere", prev.totale);
  }
  const risparmio = costoP - prev.totale;
  const consegna = prev.giorniMin ? `${prev.giorniMin}-${prev.giorniMax} giorni con ${prev.corriere}` : undefined;

  if (risparmio < SOGLIA_EUR) {
    return { fornitore: "printify", motivo: `Printify conviene o e' pari (differenza ${risparmio.toFixed(2)} EUR)`, costoGelato: prev.totale, costoPrintify: costoP, risparmio };
  }
  if (input.simula) {
    return { fornitore: "gelato", motivo: `simulazione: risparmio ${risparmio.toFixed(2)} EUR`, costoGelato: prev.totale, costoPrintify: costoP, risparmio, consegna };
  }

  // Prima si libera Printify, poi si ordina da Gelato: se l'annullamento non
  // riesce l'ordine e' gia' in stampa, e crearne un secondo lo pagherebbe due
  // volte. L'ordine giusto delle due operazioni e' l'unica cosa che protegge.
  if (ordineP.status && /production|fulfil|shipped|complete/i.test(ordineP.status)) {
    return restaSuPrintify(`Printify e' gia' in "${ordineP.status}": non lo tocco`, prev.totale, costoP);
  }
  try {
    await printify(`/shops/${input.shopIdPrintify}/orders/${ordineP.id}/cancel.json`, { method: "POST" });
  } catch (e) {
    return restaSuPrintify(`annullamento Printify fallito, non ordino da Gelato: ${e instanceof Error ? e.message : String(e)}`, prev.totale, costoP);
  }

  const creato = await creaOrdine(input.numeroOrdine, righe, input.destinatario);
  return {
    fornitore: "gelato",
    motivo: `Gelato costa ${risparmio.toFixed(2)} EUR in meno`,
    costoGelato: prev.totale, costoPrintify: costoP, risparmio, consegna,
    ordineGelato: creato.id,
  };
}
