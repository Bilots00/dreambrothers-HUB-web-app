/**
 * L'orecchio del router di produzione: riceve gli ordini da Shopify e decide
 * chi li stampa (vedi `fulfillmentRouter.ts` per il perche' della scelta).
 *
 *   POST /api/fulfillment/shopify   webhook `orders/create` di Shopify
 *   POST /api/fulfillment/simula    stessa logica, ma non crea e non annulla
 *
 * Sta sulla web app e non sul PC di Andrea perche' un ordine puo' arrivare a
 * qualsiasi ora: se il PC e' spento, Printify stampa e il risparmio e' perso.
 */
import type { Express, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { instrada, type RigaShopify } from "../fulfillmentRouter";
import type { Destinatario } from "../gelato";

/** Lo shop Printify collegato a Shopify. */
const SHOP_PRINTIFY = Number(process.env.PRINTIFY_SHOP_ID || 23834278);

/**
 * Verifica che a bussare sia davvero Shopify.
 *
 * La firma si calcola sul corpo GREZZO: se express l'ha gia' trasformato in
 * oggetto e lo si ri-serializza, basta uno spazio di differenza e l'HMAC non
 * torna piu'. Per questo `express.json` viene configurato con `verify` (vedi
 * `_core/index.ts`) che mette da parte i byte originali in `req.rawBody`.
 */
function firmaValida(req: Request): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return false;
  const inviata = String(req.headers["x-shopify-hmac-sha256"] || "");
  const raw: Buffer | undefined = (req as any).rawBody;
  if (!raw || !inviata) return false;
  const calcolata = createHmac("sha256", secret).update(raw).digest("base64");
  const a = Buffer.from(inviata, "utf8"), b = Buffer.from(calcolata, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Da "Black / M" ai due pezzi che servono a Gelato. */
function coloreTaglia(titoloVariante: string): { colore: string; taglia: string } | null {
  const p = String(titoloVariante || "").split("/").map(s => s.trim());
  if (p.length < 2) return null;
  return { colore: p[0], taglia: p[1] };
}

function destinatarioDa(ordine: any): Destinatario | null {
  const s = ordine?.shipping_address;
  if (!s || !s.country_code) return null;
  return {
    nome: s.first_name || "Cliente", cognome: s.last_name || "DreamBrothers",
    indirizzo1: s.address1 || "", indirizzo2: s.address2 || undefined,
    citta: s.city || "", cap: s.zip || "", provincia: s.province_code || undefined,
    paese: s.country_code, email: ordine.email || "info@dreambrothers.it",
    telefono: s.phone || ordine.phone || undefined,
  };
}

/** Solo i capi hanno una ricetta di stampa: il resto non e' spostabile. */
function righeDa(ordine: any): RigaShopify[] {
  return (ordine?.line_items || [])
    .filter((r: any) => r.product_id && r.variant_title)
    .map((r: any) => {
      const ct = coloreTaglia(r.variant_title);
      if (!ct) return null;
      return {
        productGid: `gid://shopify/Product/${r.product_id}`,
        colore: ct.colore, taglia: ct.taglia,
        quantita: r.quantity || 1, titolo: r.title || "",
      } as RigaShopify;
    })
    .filter(Boolean) as RigaShopify[];
}

async function decidi(ordine: any, simula: boolean) {
  const destinatario = destinatarioDa(ordine);
  const righe = righeDa(ordine);
  if (!destinatario) return { saltato: "ordine senza indirizzo di spedizione" };
  if (!righe.length) return { saltato: "nessun capo con varianti colore/taglia" };
  return instrada({
    numeroOrdine: String(ordine.name || ordine.order_number || ordine.id),
    shopIdPrintify: SHOP_PRINTIFY,
    righe, destinatario, simula,
  });
}

export function registerFulfillmentRoutes(app: Express) {
  app.post("/api/fulfillment/shopify", async (req: Request, res: Response) => {
    if (!firmaValida(req)) {
      console.warn("[fulfillment] firma non valida o SHOPIFY_WEBHOOK_SECRET mancante");
      return res.status(401).end();
    }
    // Shopify vuole una risposta entro 5 secondi: due preventivi non ci stanno.
    // Si conferma subito e si lavora dopo — se qualcosa va storto l'ordine resta
    // su Printify, che e' lo stato sicuro.
    res.status(200).end();

    // Printify riceve l'ordine dal suo canale: gli si lascia il tempo di
    // registrarlo, altrimenti non c'e' un costo da confrontare.
    setTimeout(async () => {
      const ordine = req.body;
      try {
        const esito = await decidi(ordine, false);
        console.log(`[fulfillment] ordine ${ordine?.name}: ${JSON.stringify(esito)}`);
      } catch (e) {
        console.error(`[fulfillment] ordine ${ordine?.name} NON instradato:`, e);
      }
    }, Number(process.env.FULFILLMENT_ATTESA_MS || 45_000));
  });

  // Stessa decisione senza conseguenze: serve per provare il router su un
  // ordine vero prima di lasciarlo lavorare da solo.
  app.post("/api/fulfillment/simula", async (req: Request, res: Response) => {
    if (req.headers["x-care-secret"] !== process.env.CARE_WEBHOOK_SECRET) return res.status(401).end();
    try {
      res.json(await decidi(req.body, true));
    } catch (e) {
      res.status(500).json({ errore: e instanceof Error ? e.message : String(e) });
    }
  });
}
