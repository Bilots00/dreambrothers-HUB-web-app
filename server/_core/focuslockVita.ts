import type { Express, Request, Response } from "express";
import express from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { sql } from "drizzle-orm";
import { rows } from "./focuslockSocial";

/* FocusLock / DreamMap — LA MIA VITA IN SETTIMANE, VISTA DAGLI AMICI (app 0.9.286).
 *
 * Andrea: "dopo aver annerito la casella voglio poter scrivere la pagina del diario della settimana appena passata,
 * con foto e video degli eventi importanti. Se l'utente la rende pubblica dalla scheda Profilo, gli amici che visitano
 * la sua Timeline possono toccare quelle caselle e leggere cosa ha fatto in quella settimana della sua vita".
 *
 * Il telefono tiene sempre tutto (IndexedDB): qui arriva solo quello che la persona rende pubblico, e lo leggono solo i
 * suoi amici (focuslock_friends). Le foto e i video stanno nel database (MySQL su Railway): niente servizi esterni.
 *
 * COSTI (gate economico, railway.com/pricing, ottobre 2026): lo spazio costa 0,15 $ al GB al mese. Una settimana con
 * cinque foto (rimpicciolite dal telefono, ~300 KB l'una) e un video corto pesa 2-30 MB. Tetto: 2 GB per account
 * (al massimo 0,30 $ al mese); oltre, il server risponde "spazio pieno" e la pagina resta sul telefono.
 *
 * I file si leggono con un indirizzo firmato (HMAC, 6 ore): un <img> o un <video> non possono mandare intestazioni,
 * e l'indirizzo non deve aprire niente a chi lo trova dopo. */

const TETTO_ACCOUNT = Number(process.env.FOCUSLOCK_VITA_TETTO_MB || 2048) * 1024 * 1024;
const MAX_FILE = 32 * 1024 * 1024;
const FIRMA_MS = 6 * 3600_000;
const BASE = process.env.HUB_URL || "https://meta-ai-media-buyer-production.up.railway.app";

let ready: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await rows(sql`CREATE TABLE IF NOT EXISTS focuslock_vita (
        device VARCHAR(64) PRIMARY KEY,
        vissute INT NOT NULL DEFAULT 0,
        anni INT NOT NULL DEFAULT 80,
        pubblica TINYINT NOT NULL DEFAULT 0,
        updatedAt TIMESTAMP NULL
      )`);
      await rows(sql`CREATE TABLE IF NOT EXISTS focuslock_vita_pagine (
        device VARCHAR(64) NOT NULL,
        settimana INT NOT NULL,
        inizio VARCHAR(10) NOT NULL DEFAULT '',
        testo TEXT NULL,
        media TEXT NULL,
        updatedAt TIMESTAMP NULL,
        PRIMARY KEY (device, settimana)
      )`);
      await rows(sql`CREATE TABLE IF NOT EXISTS focuslock_vita_media (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device VARCHAR(64) NOT NULL,
        chiave VARCHAR(48) NOT NULL,
        settimana INT NOT NULL,
        tipo VARCHAR(8) NOT NULL,
        mime VARCHAR(60) NOT NULL,
        peso INT NOT NULL,
        dati LONGBLOB NOT NULL,
        createdAt TIMESTAMP NULL,
        UNIQUE KEY uk_dev_chiave (device, chiave),
        INDEX idx_dev (device)
      )`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

function cors(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, range");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "content-length, content-range, accept-ranges");
}
const dev = (v: unknown) => String(v ?? "").trim().slice(0, 64);
const chiaveOk = (v: unknown) => /^[A-Za-z0-9_-]{6,48}$/.test(String(v ?? ""));
const segreto = () => process.env.JWT_SECRET || process.env.CARE_WEBHOOK_SECRET || "dreammap-vita";
export function firma(id: number, scade: number): string {
  return createHmac("sha256", segreto()).update(`vita:${id}:${scade}`).digest("base64url").slice(0, 32);
}
export function firmaValida(id: number, scade: number, s: string, adesso = Date.now()): boolean {
  if (!id || !scade || scade < adesso || scade > adesso + FIRMA_MS + 60_000) return false;
  const a = Buffer.from(firma(id, scade)), b = Buffer.from(String(s || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
function urlMedia(id: number): string {
  const scade = Date.now() + FIRMA_MS;
  return `${BASE}/api/focuslock/vita/media/${id}?t=${scade}&s=${firma(id, scade)}`;
}
async function amici(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const r = await rows(sql`SELECT 1 AS k FROM focuslock_friends WHERE device = ${a} AND friend = ${b} LIMIT 1`);
  return r.length > 0;
}

export function registerFocusLockVitaRoutes(app: Express) {
  app.options("/api/focuslock/vita*", (_req: Request, res: Response) => { cors(res); res.status(204).end(); });

  /* lo stato: le settimane vissute (il calendario dell'amico si disegna da qui) e se e' pubblica */
  app.post("/api/focuslock/vita/stato", async (req: Request, res: Response) => {
    cors(res);
    const b = req.body || {};
    const device = dev(b.device); if (!device) { res.status(400).json({ error: "device mancante" }); return; }
    const vissute = Math.max(0, Math.min(6000, Math.round(Number(b.vissute) || 0)));
    const anni = Number(b.anni) === 90 ? 90 : 80;
    const pubblica = b.pubblica ? 1 : 0;
    try {
      await ensureTables();
      await rows(sql`INSERT INTO focuslock_vita (device, vissute, anni, pubblica, updatedAt) VALUES (${device}, ${vissute}, ${anni}, ${pubblica}, NOW())
        ON DUPLICATE KEY UPDATE vissute = VALUES(vissute), anni = VALUES(anni), pubblica = VALUES(pubblica), updatedAt = NOW()`);
      res.json({ ok: true, pubblica: !!pubblica });
    } catch (e: any) { res.status(500).json({ error: e?.message || "stato non salvato" }); }
  });

  /* una pagina: il testo e le chiavi dei file che ha dentro */
  app.post("/api/focuslock/vita/pagina", async (req: Request, res: Response) => {
    cors(res);
    const b = req.body || {};
    const device = dev(b.device); const settimana = Math.round(Number(b.settimana));
    if (!device || !(settimana >= 0 && settimana < 6000)) { res.status(400).json({ error: "pagina non valida" }); return; }
    const inizio = /^\d{4}-\d{2}-\d{2}$/.test(String(b.inizio || "")) ? String(b.inizio) : "";
    const testo = String(b.testo ?? "").slice(0, 6000);
    const media = (Array.isArray(b.media) ? b.media : []).filter(chiaveOk).slice(0, 24);
    try {
      await ensureTables();
      if (b.via) { await rows(sql`DELETE FROM focuslock_vita_pagine WHERE device = ${device} AND settimana = ${settimana}`); res.json({ ok: true }); return; }
      await rows(sql`INSERT INTO focuslock_vita_pagine (device, settimana, inizio, testo, media, updatedAt) VALUES (${device}, ${settimana}, ${inizio}, ${testo}, ${JSON.stringify(media)}, NOW())
        ON DUPLICATE KEY UPDATE inizio = VALUES(inizio), testo = VALUES(testo), media = VALUES(media), updatedAt = NOW()`);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message || "pagina non salvata" }); }
  });

  /* un file (foto o video): il corpo e' il file stesso */
  app.post("/api/focuslock/vita/media", express.raw({ type: () => true, limit: MAX_FILE + 1024 }), async (req: Request, res: Response) => {
    cors(res);
    const q = req.query;
    const device = dev(q.device); const chiave = String(q.chiave || ""); const settimana = Math.round(Number(q.settimana));
    const tipo = String(q.tipo || "") === "video" ? "video" : "foto";
    const mime = /^(image|video)\/[a-z0-9.+-]{2,40}$/i.test(String(q.mime || "")) ? String(q.mime) : (tipo === "video" ? "video/mp4" : "image/jpeg");
    const dati = Buffer.isBuffer(req.body) ? req.body as Buffer : null;
    if (!device || !chiaveOk(chiave) || !(settimana >= 0 && settimana < 6000)) { res.status(400).json({ error: "file non valido" }); return; }
    if (!dati || !dati.length) { res.status(400).json({ error: "file vuoto" }); return; }
    if (dati.length > MAX_FILE) { res.status(413).json({ error: "file troppo pesante" }); return; }
    try {
      await ensureTables();
      const gia = await rows(sql`SELECT id FROM focuslock_vita_media WHERE device = ${device} AND chiave = ${chiave} LIMIT 1`);
      if (gia.length) { res.json({ ok: true, id: Number(gia[0].id) }); return; }
      const usato = await rows(sql`SELECT COALESCE(SUM(peso), 0) AS n FROM focuslock_vita_media WHERE device = ${device}`);
      if (Number(usato[0]?.n || 0) + dati.length > TETTO_ACCOUNT) { res.status(413).json({ error: "spazio pieno" }); return; }
      await rows(sql`INSERT INTO focuslock_vita_media (device, chiave, settimana, tipo, mime, peso, dati, createdAt) VALUES (${device}, ${chiave}, ${settimana}, ${tipo}, ${mime}, ${dati.length}, ${dati}, NOW())`);
      const r = await rows(sql`SELECT id FROM focuslock_vita_media WHERE device = ${device} AND chiave = ${chiave} LIMIT 1`);
      res.json({ ok: true, id: Number(r[0]?.id || 0) });
    } catch (e: any) { res.status(500).json({ error: e?.message || "file non salvato" }); }
  });
  app.post("/api/focuslock/vita/media/via", async (req: Request, res: Response) => {
    cors(res);
    const b = req.body || {};
    const device = dev(b.device); if (!device || !chiaveOk(b.chiave)) { res.status(400).json({ error: "file non valido" }); return; }
    try { await ensureTables(); await rows(sql`DELETE FROM focuslock_vita_media WHERE device = ${device} AND chiave = ${String(b.chiave)}`); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: e?.message || "file non tolto" }); }
  });

  /* la vita di un amico (o la propria): solo se e' pubblica, e solo fra amici */
  app.get("/api/focuslock/vita", async (req: Request, res: Response) => {
    cors(res);
    res.setHeader("Cache-Control", "no-store");
    const device = dev(req.query.device), of = dev(req.query.of);
    if (!device || !of) { res.status(400).json({ error: "parametri mancanti" }); return; }
    try {
      await ensureTables();
      if (!(await amici(device, of))) { res.status(403).json({ error: "non siete amici" }); return; }
      const v = await rows(sql`SELECT v.vissute, v.anni, v.pubblica, p.name FROM focuslock_vita v LEFT JOIN focuslock_players p ON p.device = v.device WHERE v.device = ${of} LIMIT 1`);
      if (!v[0] || (!Number(v[0].pubblica) && device !== of)) { res.json({ pubblica: false, nome: String(v[0]?.name || "") }); return; }
      const pg = await rows(sql`SELECT settimana, inizio, testo, media FROM focuslock_vita_pagine WHERE device = ${of} ORDER BY settimana DESC LIMIT 600`);
      const md = await rows(sql`SELECT id, chiave, tipo, mime FROM focuslock_vita_media WHERE device = ${of}`);
      const perChiave = new Map(md.map((m: any) => [String(m.chiave), m]));
      const pagine = pg.map((p: any) => {
        let chiavi: string[] = []; try { chiavi = JSON.parse(String(p.media || "[]")); } catch { chiavi = []; }
        const media = chiavi.map((k) => perChiave.get(k)).filter(Boolean).map((m: any) => ({ chiave: String(m.chiave), tipo: String(m.tipo), mime: String(m.mime), url: urlMedia(Number(m.id)) }));
        return { settimana: Number(p.settimana), inizio: String(p.inizio || ""), testo: String(p.testo || ""), media };
      });
      res.json({ pubblica: true, nome: String(v[0].name || ""), vissute: Number(v[0].vissute || 0), anni: Number(v[0].anni || 80), pagine });
    } catch (e: any) { res.status(500).json({ error: e?.message || "vita non disponibile" }); }
  });

  /* il file, con l'indirizzo firmato; i video si leggono a pezzi (Range), come vuole il lettore del telefono */
  app.get("/api/focuslock/vita/media/:id", async (req: Request, res: Response) => {
    cors(res);
    const id = Number(req.params.id || 0), scade = Number(req.query.t || 0), s = String(req.query.s || "");
    if (!firmaValida(id, scade, s)) { res.status(403).json({ error: "indirizzo scaduto" }); return; }
    try {
      await ensureTables();
      const r = await rows(sql`SELECT mime, dati FROM focuslock_vita_media WHERE id = ${id} LIMIT 1`);
      if (!r[0]) { res.status(404).json({ error: "file sparito" }); return; }
      const dati: Buffer = Buffer.isBuffer(r[0].dati) ? r[0].dati : Buffer.from(r[0].dati);
      res.setHeader("Content-Type", String(r[0].mime || "application/octet-stream"));
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "private, max-age=3600");
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
      if (range && (range[1] || range[2])) {
        let a = range[1] ? Number(range[1]) : Math.max(0, dati.length - Number(range[2]));
        let z = range[1] && range[2] ? Number(range[2]) : dati.length - 1;
        z = Math.min(z, dati.length - 1);
        if (a > z || a >= dati.length) { res.status(416).setHeader("Content-Range", `bytes */${dati.length}`); res.end(); return; }
        res.status(206).setHeader("Content-Range", `bytes ${a}-${z}/${dati.length}`);
        res.setHeader("Content-Length", String(z - a + 1));
        res.end(dati.subarray(a, z + 1));
        return;
      }
      res.setHeader("Content-Length", String(dati.length));
      res.end(dati);
    } catch (e: any) { res.status(500).json({ error: e?.message || "file non disponibile" }); }
  });
}
