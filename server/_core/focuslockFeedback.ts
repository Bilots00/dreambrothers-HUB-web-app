import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

/* FocusLock — "Invia feedback" dall'app, come StayFocused.
 *
 * Nessuna identità richiesta: chi scrive lascia (facoltativamente) un'email per la risposta.
 * Il messaggio finisce in tabella; l'owner lo legge dalla rotta admin protetta dallo stesso
 * segreto delle altre rotte server-to-server (CARE_WEBHOOK_SECRET). Rate limit grezzo per
 * indirizzo IP, perché la rotta è aperta. */

const MAX_TEXT = 4000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const seen = new Map<string, number[]>();

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_feedback (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(191),
        text TEXT NOT NULL,
        appVersion VARCHAR(32),
        device VARCHAR(120),
        locale VARCHAR(16),
        ip VARCHAR(64),
        handled TINYINT NOT NULL DEFAULT 0,
        createdAt TIMESTAMP NULL
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

function tooMany(ip: string): boolean {
  const now = Date.now();
  const hits = (seen.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) { seen.set(ip, hits); return true; }
  hits.push(now); seen.set(ip, hits);
  return false;
}

function checkSecret(req: Request, res: Response): boolean {
  const expected = process.env.CARE_WEBHOOK_SECRET;
  if (!expected) { res.status(503).json({ error: "CARE_WEBHOOK_SECRET not configured" }); return false; }
  if (req.headers["x-care-secret"] !== expected) { res.status(401).json({ error: "Unauthorized" }); return false; }
  return true;
}

export function registerFocusLockFeedbackRoutes(app: Express) {
  app.post("/api/focuslock/feedback", async (req: Request, res: Response) => {
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim().slice(0, 64);
    if (tooMany(ip)) { res.status(429).json({ error: "Troppi messaggi: riprova fra qualche minuto." }); return; }
    const b = req.body ?? {};
    const text = String(b.text || "").trim();
    if (text.length < 5) { res.status(400).json({ error: "Scrivi almeno qualche parola." }); return; }
    const email = b.email ? String(b.email).trim().slice(0, 191) : null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { res.status(400).json({ error: "Email non valida." }); return; }
    try {
      await ensureTable();
      await rows(sql`INSERT INTO focuslock_feedback (email, text, appVersion, device, locale, ip, createdAt)
        VALUES (${email}, ${text.slice(0, MAX_TEXT)}, ${b.appVersion ? String(b.appVersion).slice(0, 32) : null},
                ${b.device ? String(b.device).slice(0, 120) : null}, ${b.locale ? String(b.locale).slice(0, 16) : null}, ${ip}, NOW())`);
      res.json({ sent: true });
    } catch (e: any) {
      res.status(500).json({ error: "db: " + (e?.message || String(e)) });
    }
  });

  // Owner side: the unread messages, newest first.
  app.get("/api/focuslock/feedback", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      await ensureTable();
      const list = await rows(sql`SELECT id, email, text, appVersion, device, locale, handled, createdAt
        FROM focuslock_feedback ORDER BY id DESC LIMIT 200`);
      res.json({ feedback: list });
    } catch (e: any) {
      res.status(500).json({ error: "db: " + (e?.message || String(e)) });
    }
  });
}
