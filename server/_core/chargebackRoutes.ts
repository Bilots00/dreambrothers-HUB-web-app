/**
 * L'orecchio dei chargeback.
 *
 *   POST /api/chargeback/shopify   webhook disputes/create + disputes/update
 *   POST /api/chargeback/sync      forza una sincronizzazione (agente / cron)
 *   GET  /api/chargeback/aperti    quanti ne restano aperti (check esterni)
 *
 * Sta sulla web app e non sul PC di Andrea per lo stesso motivo del router di
 * produzione: una banca apre una contestazione quando vuole, e il tempo per
 * rispondere parte da quel momento anche se il PC e' spento.
 */
import type { Express, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ingestDisputeWebhook, sincronizzaChargebacks, contaChargebackAperti } from "../shopifyChargebacks";

/**
 * Stessa verifica del webhook ordini: l'HMAC si calcola sui byte ORIGINALI,
 * messi da parte da express.json({ verify }) in _core/index.ts.
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

export function registerChargebackRoutes(app: Express) {
  app.post("/api/chargeback/shopify", async (req: Request, res: Response) => {
    if (!firmaValida(req)) {
      console.warn("[chargeback] firma non valida o SHOPIFY_WEBHOOK_SECRET mancante");
      return res.status(401).end();
    }
    // Shopify chiude la connessione dopo 5 secondi e riprova: si conferma
    // subito e si lavora dopo. Se il lavoro fallisce la contestazione NON e'
    // persa, perche' il poller ripassa ogni 20 minuti.
    res.status(200).end();

    const payload = req.body;
    try {
      const esito = await ingestDisputeWebhook(payload);
      console.log(`[chargeback] webhook dispute ${payload?.id}: ${esito.esito}${esito.notificato ? " (Telegram inviato)" : ""}`);
    } catch (e) {
      console.error(`[chargeback] webhook dispute ${payload?.id} NON registrato:`, e);
    }
  });

  app.post("/api/chargeback/sync", async (req: Request, res: Response) => {
    if (req.headers["x-care-secret"] !== process.env.CARE_WEBHOOK_SECRET) return res.status(401).end();
    try {
      res.json({ success: true, ...(await sincronizzaChargebacks()) });
    } catch (e) {
      res.status(500).json({ errore: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/chargeback/aperti", async (req: Request, res: Response) => {
    if (req.headers["x-care-secret"] !== process.env.CARE_WEBHOOK_SECRET) return res.status(401).end();
    try {
      res.json({ success: true, aperti: await contaChargebackAperti() });
    } catch (e) {
      res.status(500).json({ errore: e instanceof Error ? e.message : String(e) });
    }
  });
}
