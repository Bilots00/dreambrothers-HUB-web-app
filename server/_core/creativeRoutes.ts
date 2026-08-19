import type { Express, Request, Response } from "express";
import { creativeInCoda, salvaCreative } from "../productArtistApprovals";
import { contestoPerAgente } from "../creativeDirector";

// Creative Director endpoints per l'agente VPS — stesso modello di marketRoutes.
// Il motore AI è l'abbonamento Claude Max sul VPS (`claude -p`), non un'API a
// pagamento: la web app mette in coda, l'agente pesca e riconsegna.
//   GET  /api/creative/pending  → design approvati che aspettano le creatività
//   POST /api/creative/result   → riconsegna il pacchetto (o l'errore)

function checkSecret(req: Request, res: Response): boolean {
  const expected = process.env.CARE_WEBHOOK_SECRET;
  if (!expected) { res.status(503).json({ error: "CARE_WEBHOOK_SECRET not configured" }); return false; }
  if (req.headers["x-care-secret"] !== expected) { res.status(401).json({ error: "Unauthorized" }); return false; }
  return true;
}

export function registerCreativeRoutes(app: Express) {
  app.get("/api/creative/pending", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const [items, brandContext] = await Promise.all([creativeInCoda(), contestoPerAgente()]);
      res.json({ success: true, count: items.length, brand_context: brandContext, items });
    } catch (e) {
      console.warn("[creative/pending]", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "pending failed" });
    }
  });

  app.post("/api/creative/result", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { data, id, pacchetto, errore } = req.body ?? {};
      if (!data || !id) { res.status(400).json({ error: "servono 'data' e 'id'" }); return; }
      if (!pacchetto && !errore) { res.status(400).json({ error: "serve 'pacchetto' oppure 'errore'" }); return; }
      await salvaCreative({ data: String(data), id: String(id), pacchetto, errore: errore ? String(errore) : undefined });
      res.json({ success: true });
    } catch (e) {
      console.warn("[creative/result]", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "result failed" });
    }
  });
}
