import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

/* FocusLock — backup dei blocchi legato all'account Google, alla AppBlock.
 *
 * AppBlock non usa Google Drive: il backup sta sui server di MobileSoft, legato all'account,
 * ed è per questo che al login compare subito. Qui è la stessa cosa, sui nostri: un
 * documento JSON per (utente Google, dispositivo), letto e scritto SOLO dall'app FocusLock
 * con in mano un ID token Google valido per il nostro client.
 *
 * Identità: l'app ottiene da Play Services un ID token (JWT firmato da Google, dura 1 ora)
 * per il client "web" del progetto FocusLock. Il server NON lo decodifica da solo: lo passa
 * a Google (tokeninfo), che risponde con sub/email solo se la firma è valida e il token non
 * è scaduto, e controlla che `aud` sia il nostro client — così un token ottenuto da un'altra
 * app, pur essendo di Google, viene rifiutato. Niente password, niente sessioni, niente
 * segreti lato app: il client ID è pubblico per costruzione.
 *
 * Cosa NON entra mai nel backup: la Modalità severa e il suo PIN. Lo decide l'app (Backup.java),
 * ma il server lo ribadisce scartando quelle chiavi se mai arrivassero.
 *
 * Tabella creata al primo uso, come le altre di questo server. */

// Client OAuth di tipo "Applicazione web" del progetto Google Cloud `focuslock-508011`.
// È l'audience dell'ID token: pubblico, non un segreto. Se il progetto cambia, cambia qui.
const FOCUSLOCK_WEB_CLIENT_ID = process.env.FOCUSLOCK_GOOGLE_CLIENT_ID
  || "516399834954-he4ihicio4ant68p0bgbq8p49ib92bp8.apps.googleusercontent.com";

const MAX_BACKUP_BYTES = 512 * 1024; // un backup reale pesa qualche KB; questo è un tetto, non una stima
const FORBIDDEN_KEYS = ["strict", "strictMode", "pin", "pinHash", "pinSalt"];

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_backups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        googleSub VARCHAR(64) NOT NULL,
        email VARCHAR(191),
        deviceId VARCHAR(64) NOT NULL,
        deviceName VARCHAR(120),
        appVersion VARCHAR(32),
        programs INT NOT NULL DEFAULT 0,
        apps INT NOT NULL DEFAULT 0,
        sites INT NOT NULL DEFAULT 0,
        keywords INT NOT NULL DEFAULT 0,
        payload MEDIUMTEXT NOT NULL,
        createdAt TIMESTAMP NULL,
        updatedAt TIMESTAMP NULL,
        UNIQUE KEY uniq_user_device (googleSub, deviceId),
        KEY idx_user (googleSub)
      )`);
    })().catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

type Identity = { sub: string; email: string | null; name: string | null };

/* Chiede a Google chi è. Una risposta 200 con aud giusto e email verificata è l'unico
 * modo di entrare. Ogni altro esito è un 401 con la ragione, mai un accesso parziale. */
async function whoIs(req: Request): Promise<Identity | { error: string; status: number }> {
  const h = String(req.headers["authorization"] || "");
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return { error: "Missing Google ID token", status: 401 };
  const idToken = m[1].trim();
  if (idToken.length < 20 || idToken.length > 4096) return { error: "Malformed token", status: 401 };

  let info: any;
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
    if (!r.ok) return { error: "Token rejected by Google", status: 401 };
    info = await r.json();
  } catch {
    return { error: "Could not verify token with Google", status: 503 };
  }
  if (info.aud !== FOCUSLOCK_WEB_CLIENT_ID) return { error: "Token is for another app", status: 401 };
  if (info.iss !== "https://accounts.google.com" && info.iss !== "accounts.google.com") {
    return { error: "Unexpected issuer", status: 401 };
  }
  if (!info.sub) return { error: "Token without subject", status: 401 };
  const exp = Number(info.exp || 0);
  if (exp && exp * 1000 < Date.now()) return { error: "Token expired", status: 401 };
  return {
    sub: String(info.sub),
    email: info.email && (info.email_verified === "true" || info.email_verified === true) ? String(info.email) : null,
    name: info.name ? String(info.name) : null,
  };
}

function isIdentity(x: any): x is Identity { return x && typeof x.sub === "string"; }

function stripForbidden(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  for (const k of FORBIDDEN_KEYS) if (k in obj) delete obj[k];
  if (obj.rules && typeof obj.rules === "object") for (const k of FORBIDDEN_KEYS) if (k in obj.rules) delete obj.rules[k];
  return obj;
}

function count(v: any): number { return Array.isArray(v) ? v.length : 0; }

function summarize(b: any) {
  // The app's backup is {kind, format, createdAt, device, appVersion, rules:{...}}: the
  // lists live under `rules`. Counting at the top level - as this did at first - showed
  // "0 programmi" over a backup holding one, and matched the app's own Backup.summarize()
  // on nothing. Top level is kept only as a fallback for a flat payload.
  const r = (b && typeof b === "object" && b.rules && typeof b.rules === "object") ? b.rules : b;
  const programs = count(r?.schedules);
  let apps = count(r?.apps) + count(r?.quick?.apps);
  let sites = count(r?.sites) + count(r?.quick?.sites);
  let keywords = count(r?.keywords) + count(r?.quick?.keywords);
  if (Array.isArray(r?.schedules)) for (const s of r.schedules) {
    apps += count(s?.apps); sites += count(s?.sites); keywords += count(s?.keywords);
  }
  return { programs, apps, sites, keywords };
}

function rowToMeta(r: any) {
  return {
    id: Number(r.id),
    deviceId: String(r.deviceId),
    deviceName: r.deviceName ? String(r.deviceName) : null,
    appVersion: r.appVersion ? String(r.appVersion) : null,
    programs: Number(r.programs || 0),
    apps: Number(r.apps || 0),
    sites: Number(r.sites || 0),
    keywords: Number(r.keywords || 0),
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
  };
}

async function rows<T = any>(q: any): Promise<T[]> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const res: any = await db.execute(q);
  // Two shapes come back from this driver, and this file got one of them wrong: sometimes
  // [rows, fields], sometimes the bare rows array. Taking res[0] on the bare array returned
  // the FIRST ROW instead of the rows, which is not an array, which became [] - and the app
  // showed "no backup yet" over a backup it had just written. Same test index.ts uses.
  const out = Array.isArray(res) ? (Array.isArray(res[0]) ? res[0] : res) : (res?.rows ?? []);
  return Array.isArray(out) ? out.filter((r: any) => r && typeof r === "object" && !Array.isArray(r)) : [];
}

export function registerFocusLockRoutes(app: Express) {
  // Chi sono io, secondo il server. Serve all'app per mostrare l'email e per capire subito
  // se il token viene accettato, prima di provare a salvare.
  app.get("/api/focuslock/me", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    res.json({ sub: who.sub, email: who.email, name: who.name });
  });

  // I backup di questo account, uno per dispositivo, il più recente per primo. Senza payload:
  // la lista deve essere leggera, il contenuto si chiede per id.
  app.get("/api/focuslock/backups", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    try {
      await ensureTable();
      const list = await rows(sql`SELECT id, deviceId, deviceName, appVersion, programs, apps, sites, keywords, createdAt, updatedAt
        FROM focuslock_backups WHERE googleSub = ${who.sub} ORDER BY updatedAt DESC`);
      res.json({ backups: list.map(rowToMeta) });
    } catch (e: any) {
      res.status(500).json({ error: "db: " + (e?.message || String(e)) });
    }
  });

  // Il contenuto di un backup, per il ripristino.
  app.get("/api/focuslock/backups/:id", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
    try {
      await ensureTable();
      const found = await rows(sql`SELECT * FROM focuslock_backups WHERE id = ${id} AND googleSub = ${who.sub} LIMIT 1`);
      if (!found.length) { res.status(404).json({ error: "not found" }); return; }
      let payload: any = null;
      try { payload = JSON.parse(String(found[0].payload)); } catch { payload = null; }
      res.json({ ...rowToMeta(found[0]), payload });
    } catch (e: any) {
      res.status(500).json({ error: "db: " + (e?.message || String(e)) });
    }
  });

  // Salva (o aggiorna) il backup di UN dispositivo. Stesso dispositivo = sovrascrive: è
  // "aggiorna il backup", non "accumula".
  app.put("/api/focuslock/backups", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    const body = req.body ?? {};
    const deviceId = String(body.deviceId || "").slice(0, 64);
    const deviceName = body.deviceName ? String(body.deviceName).slice(0, 120) : null;
    const appVersion = body.appVersion ? String(body.appVersion).slice(0, 32) : null;
    const backup = stripForbidden(body.backup);
    if (!deviceId) { res.status(400).json({ error: "deviceId is required" }); return; }
    if (!backup || typeof backup !== "object") { res.status(400).json({ error: "backup object is required" }); return; }
    const payload = JSON.stringify(backup);
    if (payload.length > MAX_BACKUP_BYTES) { res.status(413).json({ error: "backup too large" }); return; }
    // The app knows its own format better than this file does: when it sends a summary, that
    // is the one stored. The server's count is the fallback, not the authority.
    const own = body.summary && typeof body.summary === "object" ? body.summary : null;
    const s = own
      ? { programs: Number(own.programs || 0), apps: Number(own.apps || 0), sites: Number(own.sites || 0), keywords: Number(own.keywords || 0) }
      : summarize(backup);
    try {
      await ensureTable();
      await rows(sql`INSERT INTO focuslock_backups
          (googleSub, email, deviceId, deviceName, appVersion, programs, apps, sites, keywords, payload, createdAt, updatedAt)
        VALUES (${who.sub}, ${who.email}, ${deviceId}, ${deviceName}, ${appVersion}, ${s.programs}, ${s.apps}, ${s.sites}, ${s.keywords}, ${payload}, NOW(), NOW())
        ON DUPLICATE KEY UPDATE email = VALUES(email), deviceName = VALUES(deviceName), appVersion = VALUES(appVersion),
          programs = VALUES(programs), apps = VALUES(apps), sites = VALUES(sites), keywords = VALUES(keywords),
          payload = VALUES(payload), updatedAt = NOW()`);
      const saved = await rows(sql`SELECT id, deviceId, deviceName, appVersion, programs, apps, sites, keywords, createdAt, updatedAt
        FROM focuslock_backups WHERE googleSub = ${who.sub} AND deviceId = ${deviceId} LIMIT 1`);
      res.json({ saved: true, backup: saved.length ? rowToMeta(saved[0]) : null });
    } catch (e: any) {
      res.status(500).json({ error: "db: " + (e?.message || String(e)) });
    }
  });

  app.delete("/api/focuslock/backups/:id", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
    try {
      await ensureTable();
      await rows(sql`DELETE FROM focuslock_backups WHERE id = ${id} AND googleSub = ${who.sub}`);
      res.json({ deleted: true });
    } catch (e: any) {
      res.status(500).json({ error: "db: " + (e?.message || String(e)) });
    }
  });
}
