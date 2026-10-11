import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { getDb } from "../db";
import { rows } from "./focuslockRoutes";

/*
 * IL PIANO DI DREAMMAP SUL COMPUTER (app 0.9.222).
 *
 * Il quaderno del piano (la copia di Notion dentro l'app) vive nel telefono. Andrea voleva
 * leggerlo dal PC in un sito vero, veloce, invece di aspettare Notion. Qui il quaderno fa
 * avanti e indietro fra il telefono e il sito /piano/:
 *   - niente account: una CHIAVE lunga e casuale, creata dall'app, che sta nel link
 *     (/piano/#k=…). Chi ha il link legge e scrive il quaderno: il link non si condivide;
 *   - GET  /api/focuslock/piano/:k        -> { dati, at }   (dati = il quaderno in JSON, testo)
 *   - POST /api/focuslock/piano/:k        { dati, at } -> { ok, at }
 *   - POST /api/focuslock/piano/:k/img    { mime, b64 } -> { url }  (le immagini importate da Notion)
 *   - GET  /api/focuslock/piano/img/:id   -> l'immagine
 * L'unione fra le due copie la fa il client, pagina per pagina (vince la modifica piu' recente).
 */
const CHIAVE = /^[A-Za-z0-9_-]{32,64}$/;
const MAX_DATI = 40 * 1024 * 1024;
const MAX_IMG = 12 * 1024 * 1024;

let ready: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_piano (
        chiave VARCHAR(64) PRIMARY KEY,
        dati LONGTEXT NOT NULL,
        at BIGINT NOT NULL,
        updatedAt TIMESTAMP NULL
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_piano_img (
        id VARCHAR(40) PRIMARY KEY,
        chiave VARCHAR(64) NOT NULL,
        mime VARCHAR(60) NOT NULL,
        dati LONGBLOB NOT NULL,
        createdAt TIMESTAMP NULL,
        KEY idx_chiave (chiave)
      )`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const finestre = new Map<string, number[]>();
function troppe(k: string, max: number, ms: number): boolean {
  const ora = Date.now();
  const v = (finestre.get(k) || []).filter((t) => ora - t < ms);
  if (v.length >= max) { finestre.set(k, v); return true; }
  v.push(ora); finestre.set(k, v);
  if (finestre.size > 20000) finestre.clear();
  return false;
}
function ip(req: Request): string { return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim().slice(0, 64); }
function cors(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

export function registerFocusLockPianoRoutes(app: Express) {
  app.options("/api/focuslock/piano/*", (_req: Request, res: Response) => { cors(res); res.status(204).end(); });

  app.get("/api/focuslock/piano/img/:id", async (req: Request, res: Response) => {
    cors(res);
    const id = String(req.params.id || "");
    if (!/^[a-f0-9]{32}$/.test(id)) { res.status(404).end(); return; }
    try {
      await ensureTables();
      const r = await rows(sql`SELECT mime, dati FROM focuslock_piano_img WHERE id = ${id} LIMIT 1`);
      if (!r.length) { res.status(404).end(); return; }
      res.setHeader("Content-Type", String(r[0].mime || "application/octet-stream"));
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.end(Buffer.isBuffer(r[0].dati) ? r[0].dati : Buffer.from(r[0].dati));
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  app.get("/api/focuslock/piano/:k", async (req: Request, res: Response) => {
    cors(res);
    res.setHeader("Cache-Control", "no-store");
    const k = String(req.params.k || "");
    if (!CHIAVE.test(k)) { res.status(400).json({ error: "chiave non valida" }); return; }
    if (troppe("pg:" + ip(req), 1200, 3600000)) { res.status(429).json({ error: "troppe richieste" }); return; }
    try {
      await ensureTables();
      const r = await rows(sql`SELECT dati, at FROM focuslock_piano WHERE chiave = ${k} LIMIT 1`);
      if (!r.length) { res.json({ dati: null, at: 0 }); return; }
      res.json({ dati: String(r[0].dati), at: Number(r[0].at) || 0 });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  app.post("/api/focuslock/piano/:k", async (req: Request, res: Response) => {
    cors(res);
    const k = String(req.params.k || "");
    if (!CHIAVE.test(k)) { res.status(400).json({ error: "chiave non valida" }); return; }
    if (troppe("pp:" + ip(req), 900, 3600000)) { res.status(429).json({ error: "troppe richieste" }); return; }
    const b = req.body ?? {};
    const dati = typeof b.dati === "string" ? b.dati : "";
    const at = Number(b.at) || Date.now();
    if (!dati || dati.length > MAX_DATI) { res.status(400).json({ error: "quaderno vuoto o troppo grande" }); return; }
    try { const j = JSON.parse(dati); if (!j || !Array.isArray(j.pages)) throw new Error("x"); } catch { res.status(400).json({ error: "quaderno illeggibile" }); return; }
    try {
      await ensureTables();
      await rows(sql`INSERT INTO focuslock_piano (chiave, dati, at, updatedAt) VALUES (${k}, ${dati}, ${at}, NOW())
        ON DUPLICATE KEY UPDATE dati = VALUES(dati), at = VALUES(at), updatedAt = NOW()`);
      res.json({ ok: true, at });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  app.post("/api/focuslock/piano/:k/img", async (req: Request, res: Response) => {
    cors(res);
    const k = String(req.params.k || "");
    if (!CHIAVE.test(k)) { res.status(400).json({ error: "chiave non valida" }); return; }
    if (troppe("pi:" + ip(req), 2000, 3600000)) { res.status(429).json({ error: "troppe richieste" }); return; }
    const b = req.body ?? {};
    const mime = String(b.mime || "").toLowerCase();
    if (!/^(image\/(png|jpe?g|gif|webp|svg\+xml|avif)|application\/pdf)$/.test(mime)) { res.status(400).json({ error: "tipo di file non ammesso" }); return; }
    let buf: Buffer;
    try { buf = Buffer.from(String(b.b64 || ""), "base64"); } catch { res.status(400).json({ error: "file illeggibile" }); return; }
    if (!buf.length || buf.length > MAX_IMG) { res.status(400).json({ error: "file vuoto o troppo grande" }); return; }
    const id = randomBytes(16).toString("hex");
    try {
      await ensureTables();
      await rows(sql`INSERT INTO focuslock_piano_img (id, chiave, mime, dati, createdAt) VALUES (${id}, ${k}, ${mime}, ${buf}, NOW())`);
      res.json({ url: "/api/focuslock/piano/img/" + id });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });
}
