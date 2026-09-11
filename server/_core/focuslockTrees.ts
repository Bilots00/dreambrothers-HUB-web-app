import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

/* FocusLock — alberi veri dalla "Foresta reale" di FullFocus.
 *
 * Le monete guadagnate concentrandosi comprano alberi: l'app chiama questa rotta e il server
 * pianta con Tree-Nation, lo stesso partner che pianta a ogni ordine dello store. Il token
 * dell'API sta SOLO nelle variabili d'ambiente di Railway (TREENATION_TOKEN); finché non c'è,
 * le richieste vengono registrate come "in coda" e piantate a mano dall'owner.
 *
 * Tree-Nation (docs.tree-nation.com): POST {base}/api/plant con Bearer token, corpo
 * { recipients: [{ internal_id, name?, email? }], quantity }: specie, messaggio e immagine
 * sono preconfigurati nel template del token. Risposta con collect_url e certificate_url.
 * Ambiente di prova: https://youcannevertestenough.tree-nation.com.
 *
 * Tetto: cinque alberi per dispositivo (come Forest), uno al minuto per dispositivo. */

const CAP = 5;
const MIN_GAP_MS = 60 * 1000;
const TOKEN = process.env.TREENATION_TOKEN || "";
const BASE = (process.env.TREENATION_API_BASE || "https://tree-nation.com").replace(/\/$/, "");
const EXTRA = (() => { try { return JSON.parse(process.env.TREENATION_EXTRA_JSON || "{}"); } catch { return {}; } })();

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_trees (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device VARCHAR(64) NOT NULL,
        status VARCHAR(16) NOT NULL,
        collectUrl VARCHAR(512),
        certificateUrl VARCHAR(512),
        raw TEXT,
        createdAt TIMESTAMP NULL,
        INDEX idx_device (device)
      )`);
    })().catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}
async function rows(q: any): Promise<any[]> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const res: any = await db.execute(q);
  const out = Array.isArray(res) ? (Array.isArray(res[0]) ? res[0] : res) : (res?.rows ?? []);
  return Array.isArray(out) ? out.filter((r: any) => r && typeof r === "object" && !Array.isArray(r)) : [];
}

function findUrl(o: any, key: string): string {
  if (!o || typeof o !== "object") return "";
  for (const k of Object.keys(o)) {
    const v = (o as any)[k];
    if (k === key && typeof v === "string") return v;
    if (v && typeof v === "object") { const f = findUrl(v, key); if (f) return f; }
  }
  return "";
}

async function plantAtTreeNation(device: string): Promise<{ collectUrl: string; certificateUrl: string; raw: any }> {
  const body = Object.assign({ recipients: [{ internal_id: device, name: "FocusLock" }], quantity: 1 }, EXTRA);
  const r = await fetch(BASE + "/api/plant", {
    method: "POST",
    headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let raw: any = null; try { raw = JSON.parse(text); } catch { raw = { text: text.slice(0, 500) }; }
  if (!r.ok) throw new Error("Tree-Nation " + r.status + ": " + text.slice(0, 200));
  return { collectUrl: findUrl(raw, "collect_url"), certificateUrl: findUrl(raw, "certificate_url"), raw };
}

export function registerFocusLockTreeRoutes(app: Express) {
  app.get("/api/focuslock/trees", async (req: Request, res: Response) => {
    const device = String(req.query.device || "").slice(0, 64);
    try {
      await ensureTable();
      const total = await rows(sql`SELECT COUNT(*) AS n FROM focuslock_trees WHERE status IN ('planted','queued')`);
      const mine = device ? await rows(sql`SELECT id, status, collectUrl, certificateUrl, createdAt FROM focuslock_trees WHERE device = ${device} ORDER BY id`) : [];
      res.json({
        total: Number(total[0]?.n || 0),
        cap: CAP,
        configured: !!TOKEN,
        mine: mine.map((t: any) => ({ id: t.id, at: t.createdAt ? new Date(t.createdAt).getTime() : Date.now(), status: t.status, url: t.collectUrl || t.certificateUrl || "" })),
      });
    } catch (e: any) {
      res.json({ total: 0, cap: CAP, configured: !!TOKEN, mine: [], error: e?.message || String(e) });
    }
  });

  app.post("/api/focuslock/plant", async (req: Request, res: Response) => {
    const device = String((req.body && req.body.device) || "").slice(0, 64);
    if (!device) { res.status(400).json({ error: "device mancante" }); return; }
    try {
      await ensureTable();
      const mine = await rows(sql`SELECT id, createdAt FROM focuslock_trees WHERE device = ${device} AND status IN ('planted','queued') ORDER BY id DESC`);
      if (mine.length >= CAP) { res.status(429).json({ error: "hai già piantato " + CAP + " alberi" }); return; }
      const last = mine[0]?.createdAt ? new Date(mine[0].createdAt).getTime() : 0;
      if (last && Date.now() - last < MIN_GAP_MS) { res.status(429).json({ error: "un albero al minuto" }); return; }

      if (!TOKEN) {
        await rows(sql`INSERT INTO focuslock_trees (device, status, createdAt) VALUES (${device}, 'queued', NOW())`);
        const ins = await rows(sql`SELECT LAST_INSERT_ID() AS id`);
        console.log("[focuslock] tree queued (no TREENATION_TOKEN) for", device);
        res.json({ ok: true, queued: true, id: Number(ins[0]?.id || 0) });
        return;
      }
      const t = await plantAtTreeNation(device);
      await rows(sql`INSERT INTO focuslock_trees (device, status, collectUrl, certificateUrl, raw, createdAt)
        VALUES (${device}, 'planted', ${t.collectUrl}, ${t.certificateUrl}, ${JSON.stringify(t.raw).slice(0, 4000)}, NOW())`);
      const ins = await rows(sql`SELECT LAST_INSERT_ID() AS id`);
      res.json({ ok: true, queued: false, id: Number(ins[0]?.id || 0), collectUrl: t.collectUrl, certificateUrl: t.certificateUrl });
    } catch (e: any) {
      console.warn("[focuslock] plant failed:", e?.message || e);
      res.status(502).json({ error: e?.message || "piantumazione fallita" });
    }
  });
}
