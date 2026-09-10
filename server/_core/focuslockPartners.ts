import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { whoIs, isIdentity, rows } from "./focuslockRoutes";

/* FocusLock — Focus Partner: invita un amico, Pass Ospite di 14 giorni, confronto fra partner.
 *
 * Il modello è quello di AppBlock (Guest Pass) e di BlockSite (Amici della produttività),
 * ridotto a ciò che regge senza notifiche push: ogni utente ha un codice invito; chi lo
 * riscatta diventa suo partner ed entrambi ricevono 14 giorni di Premium; ogni partner
 * pubblica i propri numeri del giorno (tempo di schermo, blocchi) e li vede degli altri.
 *
 * Identità: lo stesso ID token Google delle rotte di backup (whoIs). Ai partner non viene
 * mai mostrato il `sub` Google altrui: i collegamenti si indirizzano per id del link.
 *
 * Il Premium concesso qui è "premiumUntil" sul server; l'app lo legge da /partner e lo
 * applica in locale. Non tocca gli acquisti su Google Play, che non esistono ancora. */

const PASS_DAYS = 14;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // niente 0/O, 1/I
const MAX_PARTNERS = 50;

let tableReady: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_partner_users (
        googleSub VARCHAR(64) NOT NULL PRIMARY KEY,
        code VARCHAR(12) NOT NULL,
        name VARCHAR(120),
        email VARCHAR(191),
        premiumUntil DATETIME NULL,
        todayMinutes INT NOT NULL DEFAULT 0,
        blocksToday INT NOT NULL DEFAULT 0,
        weekAvgMinutes INT NOT NULL DEFAULT 0,
        reportedAt TIMESTAMP NULL,
        createdAt TIMESTAMP NULL,
        UNIQUE KEY uniq_code (code)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_partner_links (
        id INT AUTO_INCREMENT PRIMARY KEY,
        aSub VARCHAR(64) NOT NULL,
        bSub VARCHAR(64) NOT NULL,
        inviterSub VARCHAR(64) NOT NULL,
        createdAt TIMESTAMP NULL,
        UNIQUE KEY uniq_pair (aSub, bSub),
        KEY idx_a (aSub), KEY idx_b (bSub)
      )`);
    })().catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

function newCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

function iso(v: any): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/* La riga dell'utente, creata al primo passaggio con un codice nuovo. */
async function ensureUser(sub: string, email: string | null, name: string | null) {
  let found = await rows(sql`SELECT * FROM focuslock_partner_users WHERE googleSub = ${sub} LIMIT 1`);
  if (found.length) {
    if (name && !found[0].name) {
      await rows(sql`UPDATE focuslock_partner_users SET name = ${name} WHERE googleSub = ${sub}`);
      found[0].name = name;
    }
    return found[0];
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = newCode();
    try {
      await rows(sql`INSERT INTO focuslock_partner_users (googleSub, code, name, email, createdAt)
        VALUES (${sub}, ${code}, ${name}, ${email}, NOW())`);
      break;
    } catch (e: any) {
      if (attempt === 5) throw e; // collisione sei volte di fila: non succede, ma non si cicla per sempre
    }
  }
  found = await rows(sql`SELECT * FROM focuslock_partner_users WHERE googleSub = ${sub} LIMIT 1`);
  return found[0];
}

/* Estende il Premium di N giorni da oggi o dalla scadenza già in corso, la più lontana. */
async function grantDays(sub: string, days: number) {
  await rows(sql`UPDATE focuslock_partner_users
    SET premiumUntil = DATE_ADD(GREATEST(COALESCE(premiumUntil, NOW()), NOW()), INTERVAL ${days} DAY)
    WHERE googleSub = ${sub}`);
}

async function partnersOf(sub: string) {
  const links = await rows(sql`SELECT l.id, l.aSub, l.bSub, l.inviterSub, l.createdAt,
      u.name, u.todayMinutes, u.blocksToday, u.weekAvgMinutes, u.reportedAt
    FROM focuslock_partner_links l
    JOIN focuslock_partner_users u ON u.googleSub = IF(l.aSub = ${sub}, l.bSub, l.aSub)
    WHERE l.aSub = ${sub} OR l.bSub = ${sub}
    ORDER BY l.createdAt DESC LIMIT ${MAX_PARTNERS}`);
  return links.map((r: any) => ({
    linkId: Number(r.id),
    name: r.name ? String(r.name) : "Partner",
    invitedByMe: String(r.inviterSub) === sub,
    since: iso(r.createdAt),
    todayMinutes: Number(r.todayMinutes || 0),
    blocksToday: Number(r.blocksToday || 0),
    weekAvgMinutes: Number(r.weekAvgMinutes || 0),
    reportedAt: iso(r.reportedAt),
  }));
}

function userJson(u: any) {
  return {
    code: String(u.code),
    name: u.name ? String(u.name) : null,
    premiumUntil: iso(u.premiumUntil),
    todayMinutes: Number(u.todayMinutes || 0),
    blocksToday: Number(u.blocksToday || 0),
    weekAvgMinutes: Number(u.weekAvgMinutes || 0),
    reportedAt: iso(u.reportedAt),
  };
}

export function registerFocusLockPartnerRoutes(app: Express) {
  // Il mio codice, il mio Pass, i miei partner con i loro numeri.
  app.get("/api/focuslock/partner", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    try {
      await ensureTables();
      const me = await ensureUser(who.sub, who.email, who.name);
      res.json({ me: userJson(me), partners: await partnersOf(who.sub), passDays: PASS_DAYS });
    } catch (e: any) {
      res.status(500).json({ error: "db: " + (e?.message || String(e)) });
    }
  });

  // Riscatto di un codice: chi lo inserisce diventa partner di chi lo ha condiviso, e
  // tutti e due ricevono il Pass Ospite. Un codice si riscatta una volta per coppia.
  app.post("/api/focuslock/partner/redeem", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    const code = String(req.body?.code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length < 4) { res.status(400).json({ error: "Codice non valido." }); return; }
    try {
      await ensureTables();
      const me = await ensureUser(who.sub, who.email, who.name);
      const owner = await rows(sql`SELECT * FROM focuslock_partner_users WHERE code = ${code} LIMIT 1`);
      if (!owner.length) { res.status(404).json({ error: "Nessun invito con questo codice." }); return; }
      const other = String(owner[0].googleSub);
      if (other === who.sub) { res.status(400).json({ error: "È il tuo codice: condividilo con un amico." }); return; }
      const a = other < who.sub ? other : who.sub;
      const b = other < who.sub ? who.sub : other;
      const existing = await rows(sql`SELECT id FROM focuslock_partner_links WHERE aSub = ${a} AND bSub = ${b} LIMIT 1`);
      if (existing.length) { res.status(409).json({ error: "Siete già partner." }); return; }
      const mine = await partnersOf(who.sub);
      if (mine.length >= MAX_PARTNERS) { res.status(400).json({ error: "Hai raggiunto il numero massimo di partner." }); return; }
      await rows(sql`INSERT INTO focuslock_partner_links (aSub, bSub, inviterSub, createdAt) VALUES (${a}, ${b}, ${other}, NOW())`);
      await grantDays(who.sub, PASS_DAYS);
      await grantDays(other, PASS_DAYS);
      const fresh = await rows(sql`SELECT * FROM focuslock_partner_users WHERE googleSub = ${who.sub} LIMIT 1`);
      res.json({
        linked: true,
        partnerName: owner[0].name ? String(owner[0].name) : "Il tuo amico",
        passDays: PASS_DAYS,
        me: userJson(fresh.length ? fresh[0] : me),
        partners: await partnersOf(who.sub),
      });
    } catch (e: any) {
      res.status(500).json({ error: "db: " + (e?.message || String(e)) });
    }
  });

  // I numeri di oggi, che i partner vedranno. L'app li manda quando è aperta: nessuna
  // lettura in background e niente di più preciso di quanto l'utente stesso vede.
  app.post("/api/focuslock/partner/report", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    const b = req.body ?? {};
    const clamp = (v: any, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    const todayMinutes = clamp(b.todayMinutes, 1440);
    const blocksToday = clamp(b.blocksToday, 100000);
    const weekAvgMinutes = clamp(b.weekAvgMinutes, 1440);
    const name = b.name ? String(b.name).slice(0, 120) : null;
    try {
      await ensureTables();
      await ensureUser(who.sub, who.email, who.name);
      await rows(sql`UPDATE focuslock_partner_users
        SET todayMinutes = ${todayMinutes}, blocksToday = ${blocksToday}, weekAvgMinutes = ${weekAvgMinutes},
            name = COALESCE(${name}, name), reportedAt = NOW()
        WHERE googleSub = ${who.sub}`);
      res.json({ reported: true });
    } catch (e: any) {
      res.status(500).json({ error: "db: " + (e?.message || String(e)) });
    }
  });

  // Chiudere un collegamento. Il Pass già ricevuto resta: era un regalo, non un vincolo.
  app.post("/api/focuslock/partner/remove", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    const id = Number(req.body?.linkId);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "bad linkId" }); return; }
    try {
      await ensureTables();
      await rows(sql`DELETE FROM focuslock_partner_links WHERE id = ${id} AND (aSub = ${who.sub} OR bSub = ${who.sub})`);
      res.json({ removed: true, partners: await partnersOf(who.sub) });
    } catch (e: any) {
      res.status(500).json({ error: "db: " + (e?.message || String(e)) });
    }
  });
}
