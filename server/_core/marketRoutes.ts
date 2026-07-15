import type { Express, Request, Response } from "express";
import { getMarketChanges, getUnenrichedMarketChanges, updateMarketChange, listMarketStores } from "../db";
import { runAllStoresCycle, runStoreMonitorCycle, applyMarketEnrichment, getMarketConfig } from "../marketIntelService";

// Market Intelligence endpoints per l'agente VPS / cron — stesso modello di researchRoutes.
//   GET  /api/market/stores          → elenco store monitorati
//   POST /api/market/refresh         → lancia il ciclo (uno store o tutti)
//   GET  /api/market/changes         → feed cambiamenti filtrabile
//   GET  /api/market/pending-enrich  → cambiamenti da valutare (Claude-first)
//   POST /api/market/enrichment      → riconsegna score/brief/angle
//   POST /api/market/status          → aggiorna stato del cambiamento
const OWNER_USER_ID = 1;

function checkSecret(req: Request, res: Response): boolean {
  const expected = process.env.CARE_WEBHOOK_SECRET;
  if (!expected) { res.status(503).json({ error: "CARE_WEBHOOK_SECRET not configured" }); return false; }
  if (req.headers["x-care-secret"] !== expected) { res.status(401).json({ error: "Unauthorized" }); return false; }
  return true;
}

export function registerMarketRoutes(app: Express) {
  app.get("/api/market/stores", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try { res.json({ success: true, stores: await listMarketStores(OWNER_USER_ID) }); }
    catch (e) { console.warn("[market/stores]", e); res.status(500).json({ error: "stores failed" }); }
  });

  app.post("/api/market/refresh", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const storeId = Number(req.body?.storeId);
      const r = storeId ? await runStoreMonitorCycle(OWNER_USER_ID, storeId) : await runAllStoresCycle(OWNER_USER_ID);
      res.json({ success: true, ...r });
    } catch (e) { console.warn("[market/refresh]", e); res.status(500).json({ error: "refresh failed" }); }
  });

  app.get("/api/market/changes", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const q = req.query;
      const num = (v: unknown, d: number) => { const n = parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : d; };
      const items = await getMarketChanges(OWNER_USER_ID, {
        storeId: q.store_id ? Number(q.store_id) : undefined,
        changeType: q.type ? String(q.type) : undefined,
        status: q.status ? String(q.status) : undefined,
        minScore: num(q.min_score, 0),
        hours: num(q.hours, 24),
        limit: Math.min(num(q.limit, 50), 300),
      });
      res.json({ success: true, count: items.length, items });
    } catch (e) { console.warn("[market/changes]", e); res.status(500).json({ error: "changes failed" }); }
  });

  app.get("/api/market/pending-enrich", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { brandContext } = await getMarketConfig(OWNER_USER_ID);
      const pending = await getUnenrichedMarketChanges(OWNER_USER_ID, 15);
      res.json({
        success: true, count: pending.length, brand_context: brandContext,
        items: pending.map((p) => ({ id: p.id, changeType: p.changeType, title: p.title, url: p.url, oldValue: p.oldValue, newValue: p.newValue, detail: p.detail })),
      });
    } catch (e) { console.warn("[market/pending-enrich]", e); res.status(500).json({ error: "pending-enrich failed" }); }
  });

  app.post("/api/market/enrichment", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { items } = req.body ?? {};
      if (!Array.isArray(items) || !items.length) { res.status(400).json({ error: "items[] required (id, score, brief, angle)" }); return; }
      res.json({ success: true, applied: await applyMarketEnrichment(items) });
    } catch (e) { console.warn("[market/enrichment]", e); res.status(500).json({ error: "enrichment failed" }); }
  });

  app.post("/api/market/status", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { id, status } = req.body ?? {};
      const valid = ["nuovo", "letto", "archiviato"];
      if (!id || !valid.includes(String(status))) { res.status(400).json({ error: `id + status (${valid.join("|")})` }); return; }
      await updateMarketChange(Number(id), { status: String(status) as "nuovo" | "letto" | "archiviato" });
      res.json({ success: true });
    } catch (e) { console.warn("[market/status]", e); res.status(500).json({ error: "status failed" }); }
  });
}
