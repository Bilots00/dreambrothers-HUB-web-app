/**
 * Printify — dall'artwork approvato al prodotto pubblicato su Shopify.
 *
 * Il flusso e' quello che l'agente sul VPS faceva a mano (`engine/printify.mjs`),
 * portato dentro la web app perche' ora parte da solo quando Andrea approva un
 * design nella pagina "Approva Design": approvare E' la decisione, quindi qui il
 * prodotto non resta in bozza come nella regola "draft first" del Brain — viene
 * pubblicato sul negozio Shopify collegato a Printify.
 *
 * Il prezzo non e' fisso: si crea il prodotto, si rileggono i costi reali di
 * stampa variante per variante e si applica il ricarico. Un prezzo unico su un
 * poster andrebbe in perdita sui formati grandi (100x140) e lascerebbe margine
 * sul tavolo sui piccoli (30x40).
 */

import { assicuraSpedizioneGratuita } from "./spedizioneGratuita";

const API = "https://api.printify.com/v1";

/** Ricarico sul costo di stampa. 3.4x tiene il margine sopra il 70% del Brain —
 *  regola nata sui poster, dove il costo e' basso. Resta SOLO per la wall art:
 *  sull'apparel il ricarico moltiplicativo e' stato la causa dei 58.99 € del
 *  leone (costo x1.8, arrotondato per eccesso al centesimo di euro superiore).
 *  Vedi `prezzoApparel`. */
const MARKUP = Number(process.env.PRINTIFY_MARKUP || 3.4);

/**
 * LISTINO APPAREL — prezzi decisi da Andrea il 21/08/2026, in centesimi di EURO
 * (la valuta del negozio Shopify e' EUR; i costi Printify invece sono in USD).
 *
 * Il prezzo di una maglietta non si calcola dal costo: si sceglie sul mercato e
 * poi si sceglie il fornitore che ci sta dentro. Il ricarico moltiplicativo
 * faceva l'opposto — un fornitore caro produceva un prezzo fuori mercato invece
 * di essere scartato.
 */
const PREZZO_FRONTE = Number(process.env.PRINTIFY_PREZZO_APPAREL_FRONTE || 2990);
const PREZZO_FRONTE_RETRO = Number(process.env.PRINTIFY_PREZZO_APPAREL_FRONTE_RETRO || 3790);

/** Printify fattura in USD, il negozio incassa in EUR: senza cambio il margine e' fantasia. */
const USD_EUR = Number(process.env.PRINTIFY_USD_EUR || 0.86);
/** Spedizione assorbita, in centesimi di USD. Si usa il caso PEGGIORE di
 *  Printify Choice (Italia/Europa, 10.00; negli USA sono 3.99): il pavimento di
 *  sicurezza deve reggere l'ordine che costa di piu', non quello medio. */
const SPEDIZIONE_USD = Number(process.env.PRINTIFY_SPEDIZIONE_USD || 1000);
/** Sotto questo margine lordo il listino fisso non regge e il prezzo sale da solo.
 *  0.35 e non 0.40: col caso peggiore di spedizione, un 40% secco faceva scattare
 *  il pavimento sulla sola 2XL (30.90 invece di 29.90) e rimetteva in pagina il
 *  prezzo-per-taglia che il listino unico serve proprio a togliere. A 0.35 il
 *  listino regge su tutte le taglie del fornitore buono, e continua a scattare
 *  su un fornitore davvero fuori mercato. */
const MARGINE_MINIMO = Number(process.env.PRINTIFY_MARGINE_MINIMO || 0.35);

export type TipoDesign = "apparel" | "wallart";

/**
 * Taglie a catalogo (decisione di Andrea, 21/08/2026: si arriva alla 2XL e basta).
 *
 * Le taglie oltre la 2XL costano fino al 45% in piu' del capo base e obbligano o
 * a un prezzo diverso per taglia — brutto sulla scheda prodotto — o a vendere in
 * perdita. La XS non c'e' perche' la Gildan 5000 non esiste in XS: il capo parte
 * dalla S (la XS e' solo sulla linea youth 5000B, un altro blueprint).
 */
export const TAGLIE_AMMESSE = ["S", "M", "L", "XL", "2XL"];

/** I fornitori scrivono la doppia X in due modi: "2XL" e "XXL" sono la stessa taglia. */
function taglia(v: Variante): string {
  const s = (v.options?.size || "").toUpperCase().replace(/\s+/g, "");
  return s === "XXL" ? "2XL" : s;
}

/**
 * I colori di capo ammessi sul brand (decisione di Andrea, 20/08: "beige,
 * bianco, nero o al massimo un grigio" — il verde bottiglia era orrendo).
 * Qualsiasi cosa l'agente proponga fuori da questa lista viene scartata.
 */
export const COLORI_CAPO_AMMESSI = ["Black", "Navy", "White", "Sand", "Sport Grey"];

/**
 * ETICHETTA AL COLLO — il logo DreamBrothers stampato dentro il capo, al posto
 * del cartellino del produttore (decisione di Andrea, 21/08/2026: "voglio dare
 * l'impressione di essere un vero brand, non uno storettino di print on demand").
 *
 * Costa 0.76 USD su Printify Choice: e' la voce con il rapporto
 * percezione/prezzo piu' alto di tutto il capo. Chi la indossa vede il nostro
 * nome ogni volta che se la mette, e chi la regala non consegna una maglietta
 * anonima.
 *
 * Due file perche' un logo bianco su un capo bianco non esiste: il nero stampa
 * la versione chiara, White/Sand/Sport Grey quella scura. Stessa logica della
 * variante chiara del design (regola del 20/08). Gli id sono immagini gia'
 * caricate su Printify: si sovrascrivono da env se il logo cambia.
 */
const ETICHETTA_CHIARA = process.env.PRINTIFY_ETICHETTA_CHIARA || "6a883717f167ec53f1b5de41";
const ETICHETTA_SCURA = process.env.PRINTIFY_ETICHETTA_SCURA || "6a883718f16da09edc74c1b9";
/** Si puo' spegnere senza toccare il codice, se un fornitore la stampa male. */
const ETICHETTA_ATTIVA = process.env.PRINTIFY_ETICHETTA_COLLO !== "off";

/**
 * Su quali capi va il logo CHIARO. Della palette ammessa e' solo il Black, ma i
 * prodotti vecchi hanno anche Navy e Charcoal: la lista evita che un logo scuro
 * finisca invisibile dentro un collo blu notte.
 */
const CAPI_SCURI = ["black", "navy", "charcoal", "dark heather", "forest green", "maroon"];
/**
 * Un capo scuro regge il design così com'è: niente variante chiara, logo al
 * collo chiaro. Serve per nome e non per variante perché la stessa domanda se
 * la fanno anche la scheda di stampa e l'aggiornamento di un prodotto già
 * creato, che hanno in mano solo il nome del colore.
 */
export function coloreScuro(nome: string): boolean {
  return CAPI_SCURI.includes((nome || "").toLowerCase());
}
function capoScuro(v: Variante): boolean {
  return coloreScuro(v.options?.color || "");
}

export type ProdottoPubblicato = {
  productId: string;
  shopId: number;
  /** scheda del prodotto dentro Printify */
  url: string;
  /** mockup generato da Printify: e' l'immagine che finisce su Shopify */
  mockup: string | null;
  titolo: string;
  varianti: number;
  prezzoDa: number | null;
  pubblicatoIl: string;
};

function token(): string {
  const t = process.env.PRINTIFY_API_TOKEN;
  if (!t) {
    throw new Error(
      "Manca PRINTIFY_API_TOKEN nelle variabili Railway. " +
        "Serve un token Printify (Account → Connections → API tokens) con scope shops.manage e products.write.",
    );
  }
  return t;
}

async function api<T>(pathname: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API}${pathname}`, {
    method: init?.method || "GET",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      // Printify rifiuta le richieste senza User-Agent identificabile.
      "User-Agent": "DreamBrothers-HUB",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Printify ha rifiutato il token (${res.status}). Controlla PRINTIFY_API_TOKEN su Railway.`);
    }
    throw new Error(`Printify ${res.status} su ${pathname}: ${text.slice(0, 400)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/* ------------------------------------------------------------------ */
/* Negozio e modello di prodotto                                       */
/* ------------------------------------------------------------------ */

type Shop = { id: number; title: string; sales_channel: string };

/** Il negozio Shopify collegato: il catalogo vivo e' dream-brothers.com, non Etsy. */
async function negozio(): Promise<Shop> {
  const shops = await api<Shop[]>("/shops.json");
  const shop = shops.find(s => s.sales_channel === "shopify") || shops[0];
  if (!shop) throw new Error("Nessun negozio collegato su Printify: collega prima lo store Shopify.");
  return shop;
}

type Variante = {
  id: number;
  title: string;
  options: Record<string, string>;
  /** le aree stampabili del capo, in px: servono a sapere quanto e' alta rispetto a quanto e' larga */
  placeholders?: { position: string; width: number; height: number }[];
};

/** Il riquadro del disegno dentro il file di stampa, misurato sul PC (`_print.meta.json`). */
export type ContenutoStampa = { top: number; bottom: number; left?: number; right?: number };

/**
 * Quanto in basso finisce il disegno sul capo, come frazione dell'area di stampa.
 *
 * Il valore fisso di prima (0.47) centrava il FILE. Ma un file puo' essere
 * verticale con dentro un disegno quadrato e un buco trasparente in cima: e'
 * il caso dei design tipografici, e il 21/08 "it's all waiting there for you"
 * e' uscito con la frase sotto le ascelle, dove chi ti guarda non legge.
 *
 * Qui si ragiona sul DISEGNO: si tiene il suo bordo superiore a una distanza
 * fissa dal colletto, com'e' abitudine stampare un capo, e si lascia che sia
 * l'altezza del disegno a decidere dove cade il centro. Un artwork che riempie
 * tutto il file torna esattamente dov'era prima (~0.47): sale solo cio' che
 * prima scendeva per via dei propri margini vuoti.
 */
const MARGINE_COLLO = 0.1;
export function altezzaSulCapo(
  area: { width: number; height: number } | null,
  file: { w: number; h: number } | null,
  contenuto: ContenutoStampa | null,
  scale: number,
): number {
  if (!file || !contenuto || !file.w || !file.h) return 0.47;
  // Senza le misure dell'area si usa il rapporto tipico di una t-shirt adulto
  // (12x16 pollici): sbagliare un po' il rapporto sposta il disegno di poco,
  // non sapere dov'e' il disegno lo sposta di molto.
  const rapportoArea = area?.width && area?.height ? area.width / area.height : 0.75;
  const occupata = scale * (file.h / file.w) * rapportoArea;
  const y = MARGINE_COLLO + occupata * (0.5 - contenuto.top);
  // Mai sopra il bordo dell'area, e mai piu' in basso del centro: se il disegno
  // e' cosi' grande da non starci, il centro e' il meglio che si possa fare.
  return Math.min(0.5, Math.max(occupata / 2, Number(y.toFixed(4))));
}

/**
 * Blueprint e print provider per tipo di design.
 *
 * L'apparel usa la Gildan 5000 (blueprint 6) da Printify Choice (provider 99).
 *
 * Il default era Printful (410) e costava troppo: 14.15 USD di capo e 9.38 di
 * seconda stampa, contro 9.50 e 6.08 di Printify Choice (misurato sull'API il
 * 21/08/2026). Con la doppia stampa, 23.53 USD contro 15.58.
 *
 * La scelta del fornitore la decide **dove stanno i clienti, non dove sta
 * Andrea**. I fornitori europei costano meno in Europa ma sono un disastro
 * oltreoceano, e viceversa. Costo sbarcato di un capo fronte-solo, USD:
 *
 *              Italia   Stati Uniti
 *   99 Choice   19.50      13.49    ← unico decente in tutti e due
 *   30 OPT      13.39      34.39    ← imbattibile in EU, perdita secca in US
 *   410 Printful 18.94     18.44    ← piatto ovunque, ma il capo costa il 49% in piu'
 *
 * Gli ordini VERI dello store sono USA e Olanda (verificato sugli ordini reali,
 * escludendo gli auto-ordini di test), quindi un fornitore solo-EU manderebbe in
 * perdita proprio gli ordini che arrivano davvero. Printify Choice instrada da
 * solo allo stabilimento piu' vicino al cliente: e' l'unico che non ha un caso
 * catastrofico. Se un giorno il traffico diventasse europeo, il fornitore giusto
 * diventerebbe OPT OnDemand (30) e si cambia con `PRINTIFY_PROVIDER_APPAREL`.
 *
 * Per la wall art non c'e' un default sicuro da indovinare: o arriva dalle env,
 * o si cerca a catalogo, cosi' un id sbagliato non finisce a creare prodotti sul
 * negozio vero.
 */
async function modello(
  tipo: TipoDesign,
  colori?: string[],
  orientamento?: Orientamento,
): Promise<{ blueprint: number; provider: number; varianti: Variante[] }> {
  const envBlueprint = Number(
    tipo === "apparel" ? process.env.PRINTIFY_BLUEPRINT_APPAREL : process.env.PRINTIFY_BLUEPRINT_WALLART,
  );
  const envProvider = Number(
    tipo === "apparel" ? process.env.PRINTIFY_PROVIDER_APPAREL : process.env.PRINTIFY_PROVIDER_WALLART,
  );

  let blueprint = envBlueprint || (tipo === "apparel" ? 6 : 0);
  let provider = envProvider || (tipo === "apparel" ? 99 : 0);

  if (!blueprint) {
    // Wall art senza configurazione: si cerca a catalogo un poster/canvas.
    const catalogo = await api<{ id: number; title: string }[]>("/catalog/blueprints.json");
    const trovato = catalogo.find(b => /poster|canvas/i.test(b.title));
    if (!trovato) {
      throw new Error(
        "Nessun blueprint poster/canvas trovato a catalogo. Imposta PRINTIFY_BLUEPRINT_WALLART " +
          "e PRINTIFY_PROVIDER_WALLART nelle variabili Railway.",
      );
    }
    blueprint = trovato.id;
  }

  if (!provider) {
    const providers = await api<{ id: number; title: string }[]>(
      `/catalog/blueprints/${blueprint}/print_providers.json`,
    );
    if (!providers.length) throw new Error(`Nessun print provider per il blueprint ${blueprint}.`);
    provider = providers[0].id;
  }

  const cat = await api<{ variants: Variante[] }>(
    `/catalog/blueprints/${blueprint}/print_providers/${provider}/variants.json`,
  );

  // Sull'apparel si stampa nei colori decisi per QUESTO design: un artwork
  // chiaro su un capo bianco sparisce, uno scuro su un capo nero pure. Il nero
  // resta il default solo quando nessuno ha deciso niente.
  let varianti = cat.variants;
  if (tipo === "apparel") {
    const ammessi = COLORI_CAPO_AMMESSI.map(c => c.toLowerCase());
    const filtrati = (colori?.length ? colori : ["Black"]).filter(c => ammessi.includes(c.toLowerCase()));
    const volute = (filtrati.length ? filtrati : ["Black"]).map(c => c.toLowerCase());
    varianti = cat.variants.filter(v => volute.includes((v.options?.color || "").toLowerCase()));
    if (!varianti.length) {
      const disponibili = Array.from(
        new Set(cat.variants.map(v => v.options?.color).filter(Boolean)),
      );
      throw new Error(
        `Nessuna variante per i colori ${JSON.stringify(colori)}. ` +
          `Su questo capo esistono: ${disponibili.slice(0, 20).join(", ")}.`,
      );
    }

    // Dalla 3XL in su il capo rincara e il prezzo unico non regge: si taglia qui,
    // prima che le varianti finiscano nel prodotto (vedi TAGLIE_AMMESSE).
    const inTaglia = varianti.filter(v => TAGLIE_AMMESSE.includes(taglia(v)));
    if (!inTaglia.length) {
      const disponibili = Array.from(new Set(varianti.map(taglia).filter(Boolean)));
      throw new Error(
        `Nessuna taglia ammessa (${TAGLIE_AMMESSE.join(", ")}) sul blueprint ${blueprint}. ` +
          `Il fornitore offre: ${disponibili.join(", ")}.`,
      );
    }
    varianti = inTaglia;
  }

  // Sulla wall art l'orientamento non e' un dettaglio: un artwork 3:4 verticale
  // messo su un poster orizzontale viene riempito e ritagliato, e il testo sopra
  // e sotto sparisce (visto sul primo poster pubblicato il 20/08).
  if (tipo === "wallart" && orientamento) {
    const stessoVerso = varianti.filter(v => orientamentoVariante(v) === orientamento);
    if (stessoVerso.length) varianti = stessoVerso;
  }

  if (!varianti.length) throw new Error(`Nessuna variante utilizzabile per il blueprint ${blueprint}.`);
  return { blueprint, provider, varianti };
}

export type Orientamento = "verticale" | "orizzontale" | "quadrato";

export function orientamentoDa(w: number, h: number): Orientamento {
  const r = w / h;
  if (r > 1.05) return "orizzontale";
  if (r < 0.95) return "verticale";
  return "quadrato";
}

/**
 * L'orientamento di una variante, letto dalle misure nel titolo.
 *
 * I titoli dei poster sono tipo `12" x 18"` o `30x40 cm`: si prendono i primi
 * due numeri. Se non se ne trovano, la variante non si esclude — meglio tenerla
 * che buttare via tutto il catalogo per un titolo scritto in modo strano.
 */
function orientamentoVariante(v: Variante): Orientamento | null {
  const testo = `${v.title} ${Object.values(v.options || {}).join(" ")}`;
  const numeri = testo.match(/\d+(?:[.,]\d+)?/g);
  if (!numeri || numeri.length < 2) return null;
  const a = parseFloat(numeri[0].replace(",", "."));
  const b = parseFloat(numeri[1].replace(",", "."));
  if (!a || !b) return null;
  return orientamentoDa(a, b);
}

/* ------------------------------------------------------------------ */
/* Pubblicazione                                                       */
/* ------------------------------------------------------------------ */

type ProductResp = {
  id: string;
  title: string;
  visible: boolean;
  images?: { src: string; is_default: boolean }[];
  variants?: { id: number; cost: number; price: number; is_enabled: boolean }[];
};

/** Prezzo al pubblico della wall art: ricarico sul costo e arrotondamento a .99 */
function prezzoDaCosto(costo: number, tipo: TipoDesign): number {
  const grezzo = costo * MARKUP;
  return Math.max(Math.ceil(grezzo / 100) * 100 - 1, 999);
}

/**
 * Prezzo al pubblico di un capo: listino fisso, non ricarico.
 *
 * Il listino e' lo stesso per tutte le taglie ammesse: la differenza di costo
 * fra una S e una 2XL e' 1.95 USD, e una scheda prodotto con sei prezzi diversi
 * vende meno di quanto quei due dollari valgano.
 *
 * Il pavimento serve solo come rete: se un giorno il fornitore rincara (o si
 * pubblica su uno caro), invece di vendere sotto il `MARGINE_MINIMO` il prezzo
 * sale da solo al primo .90 utile. `costo` arriva da Printify in centesimi di
 * USD, il listino e' in centesimi di EUR: senza il cambio si confronterebbero
 * due valute diverse.
 */
export function prezzoApparel(costo: number, doppiaStampa: boolean): number {
  const listino = doppiaStampa ? PREZZO_FRONTE_RETRO : PREZZO_FRONTE;
  const costoEur = (costo + SPEDIZIONE_USD) * USD_EUR;
  const pavimento = Math.ceil(costoEur / (1 - MARGINE_MINIMO) / 100) * 100 - 10;
  return Math.max(listino, pavimento);
}

/**
 * Carica l'artwork, crea il prodotto, allinea i prezzi ai costi reali e
 * pubblica sul negozio collegato.
 *
 * `base64` e' l'immagine cosi' come arriva dalla repo dell'agente.
 */
export async function pubblicaProdotto(input: {
  nomeFile: string;
  base64: string;
  titolo: string;
  descrizione: string;
  tipo: TipoDesign;
  tags?: string[];
  /** i colori del capo, decisi per questo design. Vuoto = solo nero. */
  colori?: string[];
  /** dove va la grafica: sul petto o sulla schiena */
  posizione?: "front" | "back";
  /**
   * URL pubblico e firmato da cui Printify scarica l'artwork.
   * Serve per i file di stampa: in base64 dentro il POST darebbero 413.
   */
  url?: string | null;
  /** grafica del fronte (tipografia generata), quando la principale va sul retro */
  fronte?: { nomeFile: string; url: string } | null;
  /**
   * Variante del design per i capi chiari (testi chiari scuriti da
   * engine/variante-chiara.py): White/Sand/Sport Grey stampano questa, il
   * Black stampa il file normale. Senza, tutti i capi stampano lo stesso file.
   */
  chiaro?: { nomeFile: string; url: string } | null;
  /** dove sta il disegno dentro il file di stampa: decide l'altezza sul capo */
  contenuto?: ContenutoStampa | null;
  /** dimensioni del file di stampa in px */
  fileStampa?: { w: number; h: number } | null;
}): Promise<ProdottoPubblicato> {
  const shop = await negozio();
  // L'orientamento si legge dall'artwork vero, non si assume.
  const dim = dimensioniPng(input.base64);
  const orientamento = dim ? orientamentoDa(dim.w, dim.h) : undefined;
  const { blueprint, provider, varianti } = await modello(input.tipo, input.colori, orientamento);
  const posizione = input.posizione || "front";

  // Per URL non c'e' limite di dimensione; il base64 resta come rete di
  // sicurezza per quando l'app non sa qual e' il suo indirizzo pubblico.
  const up = await api<{ id: string; width: number; height: number }>("/uploads/images.json", {
    method: "POST",
    body: input.url
      ? { file_name: input.nomeFile, url: input.url }
      : { file_name: input.nomeFile, contents: input.base64 },
  });

  // Il fronte e' tipografia leggera: si carica solo se la grafica va sul retro.
  let upFronte: { id: string } | null = null;
  if (posizione === "back" && input.fronte) {
    upFronte = await api<{ id: string }>("/uploads/images.json", {
      method: "POST",
      body: { file_name: input.fronte.nomeFile, url: input.fronte.url },
    });
  }

  // La variante per i capi chiari, se il design ce l'ha.
  let upChiaro: { id: string } | null = null;
  if (input.tipo === "apparel" && input.chiaro) {
    upChiaro = await api<{ id: string }>("/uploads/images.json", {
      method: "POST",
      body: { file_name: input.chiaro.nomeFile, url: input.chiaro.url },
    });
  }

  // L'area di stampa del capo, per sapere quanto e' alta rispetto a quanto e'
  // larga: senza, il disegno si posiziona alla cieca.
  const areaCapo =
    varianti[0]?.placeholders?.find(p => p.position === posizione) ||
    varianti[0]?.placeholders?.[0] ||
    null;
  const SCALA_APPAREL = input.tipo === "apparel" ? 0.9 : 1;
  const altezzaCapo = altezzaSulCapo(
    areaCapo,
    input.fileStampa || null,
    input.contenuto || null,
    SCALA_APPAREL,
  );

  const areaDiStampa = (imgId: string, variantIds: number[], scuro: boolean) => ({
    variant_ids: variantIds,
    placeholders: [
      // Il fronte e' lo stesso per capi scuri e chiari: la tipografia di
      // engine/fronte.py nasce cremisi con contorno scuro, leggibile ovunque.
      ...(upFronte
        ? [{
            position: "front",
            images: [{ id: upFronte.id, x: 0.5, y: 0.38, scale: 0.42, angle: 0 }],
          }]
        : []),
      {
        position: posizione,
        images: [
          {
            id: imgId,
            // 0.5/0.5 e' il centro dell'area di stampa. Sull'apparel si alza
            // un filo: una grafica centrata geometricamente, indossata, sembra bassa.
            x: 0.5,
            y: input.tipo === "apparel" ? altezzaCapo : 0.5,
            scale: SCALA_APPAREL,
            angle: 0,
          },
        ],
      },
      // L'etichetta di marca dentro il collo, al posto di quella Gildan. Piccola
      // (scale 0.7) e centrata: l'area di stampa del collo e' gia' stretta, un
      // logo a piena larghezza finirebbe sulle cuciture.
      ...(input.tipo === "apparel" && ETICHETTA_ATTIVA
        ? [{
            position: "neck",
            images: [
              { id: scuro ? ETICHETTA_CHIARA : ETICHETTA_SCURA, x: 0.5, y: 0.5, scale: 0.7, angle: 0 },
            ],
          }]
        : []),
    ],
  });

  // Capi scuri e capi chiari vanno comunque separati, anche senza variante
  // chiara del design: l'etichetta al collo cambia colore con il capo, quindi
  // servono due print area distinte in ogni caso.
  const scure = varianti.filter(capoScuro);
  const chiare = varianti.filter(v => !capoScuro(v));
  const printAreas = [
    ...(scure.length ? [areaDiStampa(up.id, scure.map(v => v.id), true)] : []),
    // Il file chiaro (testi scuriti) si usa solo se esiste; altrimenti i capi
    // chiari stampano lo stesso design dei neri, come prima.
    ...(chiare.length ? [areaDiStampa(upChiaro?.id || up.id, chiare.map(v => v.id), false)] : []),
  ];

  const creato = await api<ProductResp>(`/shops/${shop.id}/products.json`, {
    method: "POST",
    body: {
      title: input.titolo,
      description: input.descrizione,
      blueprint_id: blueprint,
      print_provider_id: provider,
      tags: input.tags || [],
      // Prezzo provvisorio: viene riscritto sotto sui costi reali.
      variants: varianti.map(v => ({ id: v.id, price: 3200, is_enabled: true })),
      print_areas: printAreas,
    },
  });

  // Il capo si paga a stampa: fronte + retro sono due addebiti, non uno. Il
  // listino alto vale solo quando il capo e' davvero stampato da due parti.
  const doppiaStampa = input.tipo === "apparel" && posizione === "back" && !!upFronte;

  // Prezzi sui costi reali: solo ora Printify li espone, variante per variante.
  let prezzoDa: number | null = null;
  const conCosto = (creato.variants || []).filter(v => v.is_enabled && v.cost > 0);
  if (conCosto.length) {
    // Sull'apparel il prezzo e' UNO per tutta la scheda, calcolato sulla variante
    // che costa di piu': se il pavimento deve scattare, deve scattare per tutte,
    // altrimenti la 2XL finisce a un prezzo diverso e la pagina torna a mostrare
    // sei prezzi. Sulla wall art invece ogni formato ha il suo (un 100x140 e un
    // 30x40 non sono lo stesso prodotto).
    const costoMax = Math.max(...conCosto.map(v => v.cost));
    const prezzoUnico = prezzoApparel(costoMax, doppiaStampa);
    const nuovi = conCosto.map(v => ({
      id: v.id,
      price: input.tipo === "apparel" ? prezzoUnico : prezzoDaCosto(v.cost, input.tipo),
      is_enabled: true,
    }));
    prezzoDa = Math.min(...nuovi.map(v => v.price));
    await api(`/shops/${shop.id}/products/${creato.id}.json`, {
      method: "PUT",
      body: { variants: nuovi },
    });
  }

  // Pubblicazione vera: da qui Printify spinge il prodotto sullo store Shopify.
  await api(`/shops/${shop.id}/products/${creato.id}/publish.json`, {
    method: "POST",
    body: {
      title: true,
      description: true,
      images: true,
      variants: true,
      tags: true,
      keyFeatures: true,
      shipping_template: true,
    },
  });

  // Lo store promette spedizione gratuita in tutto il mondo, ma Printify porta
  // con se' il proprio profilo di consegna a pagamento: senza questo passo il
  // capo esce a 29.90 + 4.10 di spedizione e la promessa salta. Il costo vero e'
  // gia' dentro il listino, quindi qui si azzera. Non blocca la pubblicazione se
  // fallisce: il prodotto e' gia' online e la spedizione si sistema dopo.
  if (input.tipo === "apparel") {
    // L'id Shopify esiste solo DOPO la publish, e Printify lo scrive in `external`.
    const conEsterno = await api<ProductResp & { external?: { id?: string } }>(
      `/shops/${shop.id}/products/${creato.id}.json`,
    );
    const idShopify = conEsterno.external?.id;
    if (idShopify) {
      await assicuraSpedizioneGratuita(`gid://shopify/Product/${idShopify}`, m => console.log(`[printify] ${m}`));
    } else {
      console.log("[printify] Spedizione non verificata: Shopify non ha ancora restituito l'id del prodotto.");
    }
  }

  const mock = (creato.images || []).find(i => i.is_default) || (creato.images || [])[0];

  return {
    productId: creato.id,
    shopId: shop.id,
    url: `https://printify.com/app/store/${shop.id}/products/${creato.id}`,
    mockup: mock?.src || null,
    titolo: creato.title,
    varianti: varianti.length,
    prezzoDa,
    pubblicatoIl: new Date().toISOString(),
  };
}

/**
 * Aggiorna l'artwork di un prodotto Printify GIA' pubblicato, SENZA creare una
 * nuova listing: si caricano i file nuovi, si riscrivono le print area del
 * prodotto esistente e si ripubblica SOLO le immagini. Titolo, descrizione,
 * prezzo, varianti e la pagina Shopify (recensioni, url, metafield) restano
 * quelli che sono.
 *
 * Serve dopo un fix all'artwork (i pixel bianchi del leone, 20/08): rifare il
 * prodotto da zero butterebbe via la listing con la sua storia.
 */
export async function aggiornaArtworkEsistente(input: {
  productId: string;
  nomeFile: string;
  url: string;
  chiaro?: { nomeFile: string; url: string } | null;
  fronte?: { nomeFile: string; url: string } | null;
  posizione?: "front" | "back";
  /** dove sta il disegno dentro il file di stampa: decide l'altezza sul capo */
  contenuto?: ContenutoStampa | null;
  /** dimensioni del file di stampa in px */
  fileStampa?: { w: number; h: number } | null;
  titolo?: string;
  descrizione?: string;
}): Promise<{ variantiScure: number; variantiChiare: number }> {
  const shop = await negozio();
  const prodotto = await api<ProductResp & {
    blueprint_id: number;
    print_provider_id: number;
    variants?: { id: number; is_enabled: boolean }[];
  }>(`/shops/${shop.id}/products/${input.productId}.json`);

  // I colori delle varianti si leggono dal catalogo: il prodotto salvato ha
  // solo gli id.
  const cat = await api<{ variants: Variante[] }>(
    `/catalog/blueprints/${prodotto.blueprint_id}/print_providers/${prodotto.print_provider_id}/variants.json`,
  );
  const colorePer = new Map(cat.variants.map(v => [v.id, (v.options?.color || "").toLowerCase()]));
  // Printify pretende che OGNI variante del prodotto (anche quelle spente)
  // compaia in una print area: si partizionano tutte, non solo le attive.
  const tutte = prodotto.variants || [];
  if (!tutte.some(v => v.is_enabled)) throw new Error(`Il prodotto ${input.productId} non ha varianti attive.`);
  const scure = tutte.filter(v => coloreScuro(colorePer.get(v.id) || ""));
  const chiare = tutte.filter(v => !coloreScuro(colorePer.get(v.id) || ""));

  const up = await api<{ id: string }>("/uploads/images.json", {
    method: "POST",
    body: { file_name: input.nomeFile, url: input.url },
  });
  let upChiaro: { id: string } | null = null;
  if (input.chiaro && chiare.length) {
    upChiaro = await api<{ id: string }>("/uploads/images.json", {
      method: "POST",
      body: { file_name: input.chiaro.nomeFile, url: input.chiaro.url },
    });
  }
  let upFronte: { id: string } | null = null;
  const posizione = input.posizione || "back";
  if (posizione === "back" && input.fronte) {
    upFronte = await api<{ id: string }>("/uploads/images.json", {
      method: "POST",
      body: { file_name: input.fronte.nomeFile, url: input.fronte.url },
    });
  }

  // Stessa regola della creazione: si posiziona il disegno, non il file.
  const altezzaCapo = altezzaSulCapo(
    cat.variants[0]?.placeholders?.find(p => p.position === posizione) ||
      cat.variants[0]?.placeholders?.[0] ||
      null,
    input.fileStampa || null,
    input.contenuto || null,
    0.9,
  );

  // L'etichetta al collo va RISCRITTA anche qui. Le print_areas di Printify si
  // sostituiscono in blocco, non si fondono: una PUT senza il collo cancella
  // l'etichetta di marca dal capo (successo il 21/08 sul primo "riallinea", il
  // logo DreamBrothers e' sparito da un prodotto che ce l'aveva). Il colore
  // dell'etichetta segue il capo, come alla creazione.
  const area = (imgId: string, ids: number[], scuro: boolean) => ({
    variant_ids: ids,
    placeholders: [
      ...(upFronte
        ? [{ position: "front", images: [{ id: upFronte.id, x: 0.5, y: 0.38, scale: 0.42, angle: 0 }] }]
        : []),
      { position: posizione, images: [{ id: imgId, x: 0.5, y: altezzaCapo, scale: 0.9, angle: 0 }] },
      ...(ETICHETTA_ATTIVA
        ? [{
            position: "neck",
            images: [
              { id: scuro ? ETICHETTA_CHIARA : ETICHETTA_SCURA, x: 0.5, y: 0.5, scale: 0.7, angle: 0 },
            ],
          }]
        : []),
    ],
  });

  const printAreas =
    scure.length && chiare.length
      ? [
          area(up.id, scure.map(v => v.id), true),
          area(upChiaro?.id || up.id, chiare.map(v => v.id), false),
        ]
      : [
          area(
            upChiaro && !scure.length ? upChiaro.id : up.id,
            tutte.map(v => v.id),
            scure.length > 0,
          ),
        ];

  await api(`/shops/${shop.id}/products/${input.productId}.json`, {
    method: "PUT",
    body: {
      ...(input.titolo ? { title: input.titolo } : {}),
      ...(input.descrizione ? { description: input.descrizione } : {}),
      print_areas: printAreas,
    },
  });

  // Printify rigenera i mockup dopo la PUT: un attimo di respiro prima di
  // spingerli, altrimenti la publish parte con i vecchi.
  await new Promise(r => setTimeout(r, 45000));

  // SOLO le immagini: titolo, descrizione e varianti su Shopify non si toccano
  // (la copy giusta e' gia' sulla pagina, insieme a metafield e recensioni).
  await api(`/shops/${shop.id}/products/${input.productId}/publish.json`, {
    method: "POST",
    body: {
      title: false,
      description: false,
      images: true,
      variants: false,
      tags: false,
      keyFeatures: false,
      shipping_template: false,
    },
  });

  return { variantiScure: scure.length, variantiChiare: chiare.length };
}

/* ------------------------------------------------------------------ */
/* Qualita' di stampa                                                  */
/* ------------------------------------------------------------------ */

/**
 * Legge le dimensioni di un PNG dai primi byte dell'header IHDR.
 * Serve per avvisare quando un artwork e' sotto la soglia di stampa: Printify
 * accetta il file lo stesso, ma il risultato stampato viene morbido.
 */
export function dimensioniPng(base64: string): { w: number; h: number } | null {
  try {
    const buf = Buffer.from(base64.slice(0, 120), "base64");
    // PNG: 8 byte di firma, poi chunk IHDR (4 lunghezza + 4 tipo) → width a 16, height a 20.
    if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/** Soglia sotto la quale la stampa non regge (DTG vuole ~4500x5400). */
export const MIN_LATO_LUNGO = 2400;

/* ------------------------------------------------------------------ */
/* La ricetta di stampa                                                */
/* ------------------------------------------------------------------ */

/**
 * Scrive su Shopify come e' fatto questo capo, cosi' che un altro fornitore
 * possa rifarlo identico quando conviene (vedi `fulfillmentRouter.ts`).
 *
 * Si salvano i NOMI dei file, non i loro indirizzi: i link all'artwork sono
 * firmati e scadono dopo un'ora, quindi al momento dell'ordine vanno
 * rigenerati da capo. Senza questo metafield l'ordine non e' spostabile e
 * resta su Printify — che e' un ripiego accettabile, non un errore.
 *
 * Va chiamata DOPO la publish: prima Shopify non ha ancora il prodotto e
 * Printify non conosce il suo id esterno.
 */
export async function salvaRicettaStampa(
  productIdPrintify: string,
  ricetta: { data: string; scuro: string; chiaro?: string | null; fronte?: string | null; posizione: "front" | "back"; etichetta?: boolean },
): Promise<{ scritta: boolean; motivo?: string }> {
  const shop = await negozio();
  const prodotto = await api<{ external?: { id?: string } }>(`/shops/${shop.id}/products/${productIdPrintify}.json`);
  const idShopify = prodotto.external?.id;
  if (!idShopify) return { scritta: false, motivo: "Printify non ha ancora l'id Shopify del prodotto" };

  const dominio = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!dominio || !token) return { scritta: false, motivo: "mancano SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN" };

  const res = await fetch(`https://${dominio}/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-04"}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ message } } }`,
      variables: {
        m: [{
          ownerId: `gid://shopify/Product/${idShopify}`,
          namespace: "custom", key: "ricetta_stampa", type: "json",
          value: JSON.stringify(ricetta),
        }],
      },
    }),
  });
  const j = await res.json();
  const errori = j?.data?.metafieldsSet?.userErrors || [];
  if (j?.errors || errori.length) {
    return { scritta: false, motivo: JSON.stringify(j?.errors || errori).slice(0, 200) };
  }
  return { scritta: true };
}
