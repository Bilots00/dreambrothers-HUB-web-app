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

const API = "https://api.printify.com/v1";

/** Ricarico sul costo di stampa. 3.4x tiene il margine sopra il 70% del Brain. */
const MARKUP = Number(process.env.PRINTIFY_MARKUP || 3.4);

export type TipoDesign = "apparel" | "wallart";

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

type Variante = { id: number; title: string; options: Record<string, string> };

/**
 * Blueprint e print provider per tipo di design.
 *
 * L'apparel usa i valori gia' validati dall'agente (Gildan 5000 + Printful, che
 * stampa in Europa). Per la wall art non c'e' un default sicuro da indovinare:
 * o arriva dalle env, o si cerca a catalogo, cosi' un id sbagliato non finisce
 * a creare prodotti sul negozio vero.
 */
async function modello(tipo: TipoDesign): Promise<{ blueprint: number; provider: number; varianti: Variante[] }> {
  const envBlueprint = Number(
    tipo === "apparel" ? process.env.PRINTIFY_BLUEPRINT_APPAREL : process.env.PRINTIFY_BLUEPRINT_WALLART,
  );
  const envProvider = Number(
    tipo === "apparel" ? process.env.PRINTIFY_PROVIDER_APPAREL : process.env.PRINTIFY_PROVIDER_WALLART,
  );

  let blueprint = envBlueprint || (tipo === "apparel" ? 6 : 0);
  let provider = envProvider || (tipo === "apparel" ? 410 : 0);

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

  // Sull'apparel si stampa solo sul nero: e' il capo base del brand, e mescolare
  // i colori qui significherebbe generare decine di varianti che nessuno cura.
  const varianti =
    tipo === "apparel"
      ? cat.variants.filter(v => (v.options?.color || "").toLowerCase() === "black")
      : cat.variants;

  if (!varianti.length) throw new Error(`Nessuna variante utilizzabile per il blueprint ${blueprint}.`);
  return { blueprint, provider, varianti };
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

/** Prezzo al pubblico dal costo di stampa: ricarico e poi arrotondamento a .99 */
function prezzoDaCosto(costo: number): number {
  const grezzo = costo * MARKUP;
  return Math.max(Math.ceil(grezzo / 100) * 100 - 1, 999);
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
}): Promise<ProdottoPubblicato> {
  const shop = await negozio();
  const { blueprint, provider, varianti } = await modello(input.tipo);

  const up = await api<{ id: string; width: number; height: number }>("/uploads/images.json", {
    method: "POST",
    body: { file_name: input.nomeFile, contents: input.base64 },
  });

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
      print_areas: [
        {
          variant_ids: varianti.map(v => v.id),
          placeholders: [
            {
              position: "front",
              images: [
                {
                  id: up.id,
                  // 0.5/0.5 e' il centro dell'area di stampa. Sull'apparel si alza
                  // un filo: una grafica centrata geometricamente, indossata, sembra bassa.
                  x: 0.5,
                  y: input.tipo === "apparel" ? 0.47 : 0.5,
                  scale: input.tipo === "apparel" ? 0.9 : 1,
                  angle: 0,
                },
              ],
            },
          ],
        },
      ],
    },
  });

  // Prezzi sui costi reali: solo ora Printify li espone, variante per variante.
  let prezzoDa: number | null = null;
  const conCosto = (creato.variants || []).filter(v => v.is_enabled && v.cost > 0);
  if (conCosto.length) {
    const nuovi = conCosto.map(v => ({ id: v.id, price: prezzoDaCosto(v.cost), is_enabled: true }));
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
