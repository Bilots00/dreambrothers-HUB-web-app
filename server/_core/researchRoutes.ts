import type { Express, Request, Response } from "express";
import { getResearchItems, updateResearchItem, getResearchItemById } from "../db";
import { refreshResearch, ingestResearchItems, enrichPendingResearch } from "../researchService";

// SEO & Research endpoints per l'agente VPS / n8n / cron — stesso modello della
// watchlist: il feed è infrastruttura condivisa, chiunque (SEO Specialist, SMM,
// Market Intelligence) vi attinge con lo stesso secret.
//   GET  /api/seo/research/items    → feed filtrabile (hours, source, min_virality...)
//   POST /api/seo/research/ingest   → l'agente spinge item (Gmail/newsletter/custom)
//   POST /api/seo/research/refresh  → trigger fetch fonti + enrichment (per cron)
//   POST /api/seo/research/status   → aggiorna stato (salvato/usato/cestinato)
const OWNER_USER_ID = 1;

function checkSecret(req: Request, res: Response): boolean {
  const expected = process.env.CARE_WEBHOOK_SECRET;
  if (!expected) {
    res.status(503).json({ error: "CARE_WEBHOOK_SECRET not configured on the server" });
    return false;
  }
  if (req.headers["x-care-secret"] !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

export function registerResearchRoutes(app: Express) {
  app.get("/api/seo/research/items", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const q = req.query;
      const num = (v: unknown, d: number) => {
        const n = parseFloat(String(v ?? ""));
        return Number.isFinite(n) ? n : d;
      };
      const items = await getResearchItems(OWNER_USER_ID, {
        source: q.source ? String(q.source) : undefined,
        status: q.status ? String(q.status) : undefined,
        hours: num(q.hours, 48),
        minVirality: num(q.min_virality, 0),
        minTarget: num(q.min_target, 0),
        search: q.search ? String(q.search) : undefined,
        limit: Math.min(num(q.limit, 50), 300),
      });
      res.json({
        success: true,
        count: items.length,
        items: items.map((i) => ({
          id: i.id,
          source: i.source,
          source_detail: i.sourceDetail,
          title: i.title,
          url: i.url,
          excerpt: i.excerpt,
          brief: i.brief,
          angle: i.angle,
          virality_score: i.viralityScore,
          target_score: i.targetScore,
          interest_score: i.interestScore,
          engagement: i.engagement,
          status: i.status,
          published_at: i.publishedAt,
        })),
      });
    } catch (err) {
      console.warn("[research/items] error:", err);
      res.status(500).json({ error: "items failed" });
    }
  });

  app.post("/api/seo/research/ingest", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { items } = req.body ?? {};
      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: "items[] is required" });
        return;
      }
      const stored = await ingestResearchItems(OWNER_USER_ID, items);
      res.json({ success: true, stored });
    } catch (err) {
      console.warn("[research/ingest] error:", err);
      res.status(500).json({ error: "ingest failed" });
    }
  });

  app.post("/api/seo/research/refresh", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const result = await refreshResearch(OWNER_USER_ID);
      res.json({ success: true, ...result });
    } catch (err) {
      console.warn("[research/refresh] error:", err);
      res.status(500).json({ error: "refresh failed" });
    }
  });

  app.post("/api/seo/research/enrich", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const enriched = await enrichPendingResearch(OWNER_USER_ID, 15);
      res.json({ success: true, enriched });
    } catch (err) {
      console.warn("[research/enrich] error:", err);
      res.status(500).json({ error: "enrich failed" });
    }
  });

  app.post("/api/seo/research/status", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { id, status } = req.body ?? {};
      const valid = ["da_leggere", "salvato", "usato", "cestinato"];
      if (!id || !valid.includes(String(status))) {
        res.status(400).json({ error: `id + status (${valid.join("|")}) required` });
        return;
      }
      const item = await getResearchItemById(Number(id));
      if (!item || item.userId !== OWNER_USER_ID) {
        res.status(404).json({ error: "item non trovato" });
        return;
      }
      await updateResearchItem(Number(id), { status: String(status) as "da_leggere" | "salvato" | "usato" | "cestinato" });
      res.json({ success: true });
    } catch (err) {
      console.warn("[research/status] error:", err);
      res.status(500).json({ error: "status failed" });
    }
  });
}
