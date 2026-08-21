/**
 * Gelato — produzione dei capi, quando conviene piu' di Printify.
 *
 * PERCHE' ESISTE QUESTO FILE
 * La vetrina resta su Printify perche' e' l'unico che sa mostrare un mockup
 * diverso per ogni colore di capo: il design chiaro sul nero, quello scuro sul
 * bianco. Gelato quella cosa nella sua interfaccia non la fa, e senza il
 * cliente vede una grafica che si mimetizza col capo.
 *
 * Ma sulla PRODUZIONE Gelato costa meno in Europa: misurato il 21/08/2026 sulla
 * stessa Gildan 5000 nera M, costo sbarcato in Italia 11.68 EUR contro 16.81, e
 * consegna in 5-6 giorni con GLS invece di 8-16. Negli USA e' invece un
 * pareggio (12.30 contro 12.28), quindi non si migra tutto: si sceglie ordine
 * per ordine. Vedi `fulfillmentRouter.ts`.
 *
 * Il vincolo del design-per-colore vale SOLO per l'interfaccia di Gelato. Via
 * API ogni riga d'ordine porta il suo `productUid` (che contiene il colore) e
 * i suoi file: qui si sfrutta quello.
 */

const ORDINI = "https://order.gelatoapis.com/v4";

function chiave(): string {
  const k = process.env.GELATO_API_KEY;
  if (!k) {
    throw new Error(
      "Manca GELATO_API_KEY nelle variabili Railway. " +
        "Si trova in Gelato → Developer → API keys.",
    );
  }
  return k;
}

async function api<T>(pathname: string, body: unknown): Promise<T> {
  const res = await fetch(`${ORDINI}${pathname}`, {
    method: "POST",
    headers: { "X-API-KEY": chiave(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Gelato ha rifiutato la chiave (${res.status}). Controlla GELATO_API_KEY su Railway.`);
    }
    throw new Error(`Gelato ${res.status} su ${pathname}: ${text.slice(0, 400)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/* ------------------------------------------------------------------ */
/* Il codice prodotto                                                  */
/* ------------------------------------------------------------------ */

/**
 * Gelato non ha id numerici: il prodotto E' la stringa. Ogni pezzo del codice
 * dice una cosa, e sbagliarne uno da' 404 invece di un errore parlante.
 *
 *   ..._gqa_heavy-weight_gsi_<taglia>_gco_<colore>_gpr_<stampe>_gildan_5000
 *
 * `gpr` e' la parte che cambia col numero di stampe: `4-0` solo fronte, `0-4`
 * solo retro, `4-4` fronte e retro; poi si accodano `_shsll` manica sinistra,
 * `_shslr` destra, `_inlbl` etichetta dentro il collo. L'ordine dei suffissi
 * non e' libero: Gelato accetta solo le combinazioni che ha a catalogo, ed e'
 * questa (maniche prima dell'etichetta). Verificate tutte il 21/08/2026.
 */
const BASE = "apparel_product_gca_t-shirt_gsc_crewneck_gcu_unisex_gqa_heavy-weight";

/** I 4 colori del brand, come li scrive Gelato. */
const COLORE_GELATO: Record<string, string> = {
  black: "black",
  white: "white",
  sand: "sand",
  "sport grey": "sport-grey",
  "sport-grey": "sport-grey",
  navy: "navy",
  "light blue": "light-blue",
};

export type Stampe = {
  fronte: boolean;
  retro: boolean;
  manicaSinistra?: boolean;
  manicaDestra?: boolean;
  etichettaCollo?: boolean;
};

export function codiceProdotto(colore: string, taglia: string, stampe: Stampe): string {
  const col = COLORE_GELATO[colore.trim().toLowerCase()];
  if (!col) {
    throw new Error(
      `Colore "${colore}" non mappato su Gelato. Aggiungilo a COLORE_GELATO in gelato.ts ` +
        `(i codici sono minuscoli col trattino: sport-grey, light-blue).`,
    );
  }
  const tag = taglia.trim().toLowerCase();
  if (!/^(s|m|l|xl|2xl|3xl|4xl|5xl)$/.test(tag)) throw new Error(`Taglia "${taglia}" non valida per Gelato.`);
  if (!stampe.fronte && !stampe.retro) throw new Error("Un capo senza stampe non ha senso da ordinare.");

  let gpr = `${stampe.fronte ? "4" : "0"}-${stampe.retro ? "4" : "0"}`;
  if (stampe.manicaSinistra) gpr += "_shsll";
  if (stampe.manicaDestra) gpr += "_shslr";
  if (stampe.etichettaCollo) gpr += "_inlbl";
  return `${BASE}_gsi_${tag}_gco_${col}_gpr_${gpr}_gildan_5000`;
}

/** I nomi che Gelato da' ai singoli file, uno per posizione di stampa. */
export type FileStampa = { type: "front" | "back" | "sleeve-left" | "sleeve-right" | "neck-inner"; url: string };

/* ------------------------------------------------------------------ */
/* Preventivo e ordine                                                 */
/* ------------------------------------------------------------------ */

export type Destinatario = {
  nome: string; cognome: string; indirizzo1: string; indirizzo2?: string;
  citta: string; cap: string; provincia?: string; paese: string;
  email: string; telefono?: string;
};

export type RigaOrdine = { riferimento: string; codiceProdotto: string; file: FileStampa[]; quantita: number };

function destinatarioGelato(d: Destinatario) {
  return {
    firstName: d.nome, lastName: d.cognome,
    addressLine1: d.indirizzo1, addressLine2: d.indirizzo2 || undefined,
    city: d.citta, postCode: d.cap, state: d.provincia || undefined,
    country: d.paese, email: d.email, phone: d.telefono || undefined,
  };
}

function prodottiGelato(righe: RigaOrdine[]) {
  return righe.map(r => ({
    itemReferenceId: r.riferimento,
    productUid: r.codiceProdotto,
    quantity: r.quantita,
    // Un solo file si passa come fileUrl, piu' file come lista tipizzata:
    // Gelato accetta entrambe le forme, la seconda e' l'unica che regge il
    // fronte+retro+etichetta.
    ...(r.file.length === 1 ? { fileUrl: r.file[0].url } : { files: r.file }),
  }));
}

export type Preventivo = {
  capo: number;
  spedizione: number;
  totale: number;
  valuta: string;
  corriere: string | null;
  giorniMin: number | null;
  giorniMax: number | null;
  paeseProduzione: string | null;
};

/**
 * Quanto costerebbe DAVVERO questo ordine, spedizione inclusa.
 *
 * E' lo stesso endpoint che Gelato usa prima di accettare un ordine, quindi i
 * numeri sono quelli che finiscono in fattura — non un listino. Al netto IVA,
 * come il preventivo di Printify: sono confrontabili solo cosi'.
 */
export async function preventivo(righe: RigaOrdine[], a: Destinatario, valuta = "EUR"): Promise<Preventivo> {
  const d = await api<{ quotes?: any[] }>("/orders:quote", {
    orderReferenceId: `quote-${righe[0]?.riferimento || "x"}`,
    customerReferenceId: "dreambrothers",
    currency: valuta,
    allowMultipleQuotes: true,
    recipient: destinatarioGelato(a),
    products: prodottiGelato(righe),
  });
  const q = (d.quotes || [])[0];
  if (!q) throw new Error("Gelato non ha restituito nessun preventivo: probabile codice prodotto inesistente.");
  const capo = (q.products || []).reduce((n: number, p: any) => n + Number(p.price || 0), 0);
  // fra i corrieri proposti si guarda il piu' economico: la spedizione la
  // paghiamo noi, il cliente la vede sempre gratis.
  const m = (q.shipmentMethods || []).slice().sort((a: any, b: any) => Number(a.price) - Number(b.price))[0];
  const spedizione = m ? Number(m.price) : 0;
  return {
    capo, spedizione, totale: capo + spedizione, valuta,
    corriere: m?.name || null,
    giorniMin: m?.minDeliveryDays ?? null,
    giorniMax: m?.maxDeliveryDays ?? null,
    paeseProduzione: q.productionCountry || null,
  };
}

export type OrdineCreato = { id: string; riferimento: string; stato: string };

/** Manda l'ordine in produzione. `riferimento` e' il numero d'ordine Shopify. */
export async function creaOrdine(
  riferimento: string, righe: RigaOrdine[], a: Destinatario, valuta = "EUR",
): Promise<OrdineCreato> {
  const d = await api<{ id: string; orderReferenceId: string; fulfillmentStatus?: string }>("/orders", {
    orderType: "order",
    orderReferenceId: riferimento,
    customerReferenceId: "dreambrothers",
    currency: valuta,
    recipient: destinatarioGelato(a),
    items: prodottiGelato(righe),
  });
  return { id: d.id, riferimento: d.orderReferenceId, stato: d.fulfillmentStatus || "created" };
}
