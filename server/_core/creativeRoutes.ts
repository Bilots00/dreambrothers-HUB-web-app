import type { Express, Request, Response } from "express";
import {
  creativeInCoda, salvaCreative, getImmagine, stampaInCoda, salvaStampa, aggiornaArtwork,
} from "../productArtistApprovals";
import { contestoPerAgente } from "../creativeDirector";
import { verificaLink } from "../artworkLink";

// Creative Director endpoints per l'agente VPS — stesso modello di marketRoutes.
// Il motore AI è l'abbonamento Claude Max sul VPS (`claude -p`), non un'API a
// pagamento: la web app mette in coda, l'agente pesca e riconsegna.
//   GET  /api/creative/pending  → design approvati che aspettano le creatività
//   POST /api/creative/result   → riconsegna il pacchetto (o l'errore)
//   GET  /api/creative/pending-stampa → design che aspettano la scheda di stampa
//   POST /api/creative/stampa   → riconsegna posizione e colori del capo
//   GET  /api/artwork/:data/:file → l'artwork, per Printify (firmato, pubblico)

function checkSecret(req: Request, res: Response): boolean {
  const expected = process.env.CARE_WEBHOOK_SECRET;
  if (!expected) { res.status(503).json({ error: "CARE_WEBHOOK_SECRET not configured" }); return false; }
  if (req.headers["x-care-secret"] !== expected) { res.status(401).json({ error: "Unauthorized" }); return false; }
  return true;
}

export function registerCreativeRoutes(app: Express) {
  /**
   * L'artwork scaricabile da Printify.
   *
   * È l'unica route pubblica di questo file, e lo è per forza: dev'essere
   * Printify a scaricare il file, non noi a spedirglielo (30 MB in base64 dentro
   * un POST danno 413). Al posto dell'autenticazione c'è una firma a scadenza,
   * quindi vale solo per il file che abbiamo deciso di esporre e solo per un'ora.
   */
  app.get("/api/artwork/:data/:file", async (req: Request, res: Response) => {
    try {
      const { data, file } = req.params as Record<string, string>;
      const { exp, sig } = req.query as Record<string, string>;
      if (!verificaLink(data, file, exp, sig)) {
        res.status(403).json({ error: "Link non valido o scaduto" });
        return;
      }
      const img = await getImmagine(data, file);
      if (!img) { res.status(404).json({ error: "Artwork non trovato" }); return; }

      const bytes = Buffer.from(img.base64, "base64");
      res.setHeader("Content-Type", img.mime);
      res.setHeader("Content-Length", String(bytes.length));
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.end(bytes);
    } catch (e) {
      console.warn("[artwork]", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "artwork failed" });
    }
  });

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

  app.get("/api/creative/pending-stampa", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const items = await stampaInCoda();
      res.json({ success: true, count: items.length, items });
    } catch (e) {
      console.warn("[creative/pending-stampa]", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "pending-stampa failed" });
    }
  });

  app.post("/api/creative/stampa", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { data, id, posizione, colori, fronteComplementare, fronteTesto, fronteRiga2, fronteStile,
              titolo, descrizione, metaTitle, metaDescription, note } = req.body ?? {};
      if (!data || !id) { res.status(400).json({ error: "servono 'data' e 'id'" }); return; }
      if (!Array.isArray(colori) || !colori.length) { res.status(400).json({ error: "serve 'colori' non vuoto" }); return; }
      await salvaStampa({
        data: String(data), id: String(id),
        posizione: posizione === "back" ? "back" : "front",
        colori: colori.map(String), fronteComplementare, fronteTesto, fronteRiga2, fronteStile,
        titolo, descrizione, metaTitle, metaDescription, note,
      });
      res.json({ success: true });
    } catch (e) {
      console.warn("[creative/stampa]", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "stampa failed" });
    }
  });

  /* Aggiorna l'artwork del prodotto Printify esistente (niente nuova listing).
     Route con secret perche' la usa anche il PC di Andrea via curl, non solo
     la UI: e' l'uscita di emergenza quando l'artwork era sbagliato. */
  app.post("/api/creative/aggiorna-artwork", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { data, id } = req.body ?? {};
      if (!data || !id) { res.status(400).json({ error: "servono 'data' e 'id'" }); return; }
      const esito = await aggiornaArtwork(String(data), String(id));
      res.json({ success: true, ...esito });
    } catch (e) {
      console.warn("[creative/aggiorna-artwork]", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "aggiorna-artwork failed" });
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
