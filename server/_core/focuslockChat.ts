import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { whoIs, isIdentity, rows } from "./focuslockRoutes";

/* Focus2Dream — l'agente personale di ogni utente: la coda dei messaggi e i canali.
 *
 * COSA C'È QUI. Tre tabelle: i messaggi (in e out, per ogni canale), i collegamenti ai canali
 * esterni (Telegram e WhatsApp, agganciati con un codice generato dall'app) e il profilo
 * dell'agente (il nome scelto e il «brief»: quello che l'app sa dell'utente, che viaggia con
 * ogni messaggio così il lavoratore sul VPS non deve leggere niente altro).
 *
 * LA DIREZIONE, come per Jordan: il VPS fa polling con il segreto condiviso (x-care-secret),
 * prende i messaggi in attesa, risponde con `claude -p` e deposita. L'app legge con il token
 * Google dell'utente. Il server non chiama mai il VPS.
 *
 * CHI PUÒ. Gli account in FOCUSLOCK_AGENT_EMAILS, oppure tutti se FOCUSLOCK_AGENT_OPEN=1 (il
 * giorno del lancio si accende una variabile, non si ripubblica l'app). Le rotte del segreto
 * lavorano solo sui messaggi che gli utenti stessi hanno scritto: qui non c'è nessuna riga di
 * sistema di nessuno, e il brief lo compone l'app con i dati che l'utente vede già.
 *
 * WHATSAPP. Il webhook del Cloud API di Meta arriva qui (GET per la verifica, POST per i
 * messaggi). Serve un numero verificato in Meta Business: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID,
 * WHATSAPP_VERIFY_TOKEN, WHATSAPP_NUMERO. Senza, il canale si presenta come «in arrivo». */

const MAX_TESTO = 4000;
const MAX_AZIONI_BYTES = 32 * 1024;
const MAX_AL_GIORNO = Number(process.env.FOCUSLOCK_AGENT_MAX_DAY || 40);
const CANALI = ["app", "telegram", "whatsapp"] as const;
type Canale = typeof CANALI[number];

let ready: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_agent_msgs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        googleSub VARCHAR(64) NOT NULL,
        email VARCHAR(191),
        canale VARCHAR(16) NOT NULL,
        direzione VARCHAR(4) NOT NULL,
        testo TEXT NOT NULL,
        azioni MEDIUMTEXT NULL,
        stato VARCHAR(12) NOT NULL DEFAULT 'attesa',
        inReplyTo INT NULL,
        createdAt TIMESTAMP NULL,
        KEY idx_user (googleSub, id),
        KEY idx_stato (stato, id)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_agent_links (
        id INT AUTO_INCREMENT PRIMARY KEY,
        googleSub VARCHAR(64) NOT NULL,
        email VARCHAR(191),
        canale VARCHAR(16) NOT NULL,
        codice VARCHAR(12) NULL,
        esterno VARCHAR(64) NULL,
        createdAt TIMESTAMP NULL,
        collegatoAt TIMESTAMP NULL,
        UNIQUE KEY uniq_user_canale (googleSub, canale),
        KEY idx_esterno (canale, esterno),
        KEY idx_codice (codice)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_agent_profilo (
        googleSub VARCHAR(64) NOT NULL PRIMARY KEY,
        email VARCHAR(191),
        nome VARCHAR(40),
        brief MEDIUMTEXT,
        updatedAt TIMESTAMP NULL
      )`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

function checkSecret(req: Request, res: Response): boolean {
  const expected = process.env.CARE_WEBHOOK_SECRET;
  if (!expected) { res.status(503).json({ error: "CARE_WEBHOOK_SECRET not configured" }); return false; }
  if (req.headers["x-care-secret"] !== expected) { res.status(401).json({ error: "Unauthorized" }); return false; }
  return true;
}
function aperto(): boolean { return /^(1|true|yes)$/i.test(String(process.env.FOCUSLOCK_AGENT_OPEN || "")); }
function ammesso(email: string | null): boolean {
  if (aperto()) return true;
  const lista = String(process.env.FOCUSLOCK_AGENT_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const mia = String(email || "").trim().toLowerCase();
  return !!mia && lista.includes(mia);
}
function canali() {
  return {
    telegramBot: String(process.env.FOCUSLOCK_TELEGRAM_BOT || "").replace(/^@/, ""),
    whatsappNumero: String(process.env.WHATSAPP_NUMERO || "").replace(/[^\d+]/g, ""),
  };
}
function parse(x: unknown): unknown { if (typeof x !== "string") return x ?? null; try { return JSON.parse(x); } catch { return null; } }
function codiceNuovo(): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  return s;
}
function pulisci(t: unknown, max = MAX_TESTO): string { return String(t ?? "").replace(/\u0000/g, "").trim().slice(0, max); }

async function utente(req: Request, res: Response) {
  const who = await whoIs(req);
  if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return null; }
  if (!ammesso(who.email)) { res.status(403).json({ error: "agent not enabled for this account" }); return null; }
  return who;
}

async function inserisci(sub: string, email: string | null, canale: Canale, direzione: "in" | "out", testo: string, azioni: unknown, inReplyTo: number | null, stato: string) {
  const az = azioni ? JSON.stringify(azioni).slice(0, MAX_AZIONI_BYTES) : null;
  await rows(sql`INSERT INTO focuslock_agent_msgs (googleSub, email, canale, direzione, testo, azioni, stato, inReplyTo, createdAt)
    VALUES (${sub}, ${email}, ${canale}, ${direzione}, ${testo}, ${az}, ${stato}, ${inReplyTo}, NOW())`);
  const r = await rows(sql`SELECT LAST_INSERT_ID() AS id`);
  return Number(r[0]?.id || 0);
}

/** Quanti messaggi ha scritto oggi: il tetto per persona protegge l'abbonamento, non l'utente. */
async function scrittiOggi(sub: string): Promise<number> {
  const r = await rows(sql`SELECT COUNT(*) AS n FROM focuslock_agent_msgs
    WHERE googleSub = ${sub} AND direzione = 'in' AND createdAt >= (NOW() - INTERVAL 1 DAY)`);
  return Number(r[0]?.n || 0);
}

async function mandaWhatsapp(to: string, testo: string): Promise<boolean> {
  const token = process.env.WHATSAPP_TOKEN, phone = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phone) return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${phone}/messages`, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: testo.slice(0, 4000) } }),
    });
    return r.ok;
  } catch { return false; }
}

export function registerFocusLockChatRoutes(app: Express) {
  /* ---- l'app, con il token dell'utente ---- */
  app.get("/api/focuslock/agent/chat/enabled", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    res.json({ enabled: ammesso(who.email), ...canali() });
  });

  app.post("/api/focuslock/agent/chat/profilo", async (req: Request, res: Response) => {
    const who = await utente(req, res); if (!who) return;
    const nome = pulisci((req.body ?? {}).nome, 40) || "Genio";
    const brief = pulisci((req.body ?? {}).brief, 12000);
    try {
      await ensureTables();
      await rows(sql`INSERT INTO focuslock_agent_profilo (googleSub, email, nome, brief, updatedAt)
        VALUES (${who.sub}, ${who.email}, ${nome}, ${brief}, NOW())
        ON DUPLICATE KEY UPDATE nome = VALUES(nome), brief = IF(VALUES(brief) = '', brief, VALUES(brief)), email = VALUES(email), updatedAt = NOW()`);
      res.json({ saved: true, nome });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  app.post("/api/focuslock/agent/chat", async (req: Request, res: Response) => {
    const who = await utente(req, res); if (!who) return;
    const testo = pulisci((req.body ?? {}).testo);
    if (!testo) { res.status(400).json({ error: "testo is required" }); return; }
    try {
      await ensureTables();
      if ((await scrittiOggi(who.sub)) >= MAX_AL_GIORNO) { res.status(429).json({ error: "daily limit", limit: MAX_AL_GIORNO }); return; }
      const brief = pulisci((req.body ?? {}).brief, 12000);
      if (brief) {
        await rows(sql`INSERT INTO focuslock_agent_profilo (googleSub, email, nome, brief, updatedAt)
          VALUES (${who.sub}, ${who.email}, ${"Genio"}, ${brief}, NOW())
          ON DUPLICATE KEY UPDATE brief = VALUES(brief), updatedAt = NOW()`);
      }
      const id = await inserisci(who.sub, who.email, "app", "in", testo, null, null, "attesa");
      res.json({ id });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  app.get("/api/focuslock/agent/chat", async (req: Request, res: Response) => {
    const who = await utente(req, res); if (!who) return;
    const after = Number(req.query.after || 0) || 0;
    try {
      await ensureTables();
      const lista = await rows(sql`SELECT id, canale, direzione, testo, azioni, stato, inReplyTo, createdAt
        FROM focuslock_agent_msgs WHERE googleSub = ${who.sub} AND id > ${after} ORDER BY id ASC LIMIT 80`);
      const attesa = await rows(sql`SELECT COUNT(*) AS n FROM focuslock_agent_msgs
        WHERE googleSub = ${who.sub} AND direzione = 'in' AND stato IN ('attesa', 'lavoro')`);
      res.json({
        messaggi: lista.map((m: any) => ({ id: Number(m.id), canale: m.canale, direzione: m.direzione, testo: m.testo,
          azioni: parse(m.azioni), stato: m.stato, at: m.createdAt ? new Date(m.createdAt).getTime() : 0 })),
        inAttesa: Number(attesa[0]?.n || 0) > 0,
      });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  app.post("/api/focuslock/agent/chat/link", async (req: Request, res: Response) => {
    const who = await utente(req, res); if (!who) return;
    const canale = String((req.body ?? {}).canale || "");
    if (canale !== "telegram" && canale !== "whatsapp") { res.status(400).json({ error: "canale must be telegram or whatsapp" }); return; }
    try {
      await ensureTables();
      const codice = codiceNuovo();
      await rows(sql`INSERT INTO focuslock_agent_links (googleSub, email, canale, codice, esterno, createdAt, collegatoAt)
        VALUES (${who.sub}, ${who.email}, ${canale}, ${codice}, NULL, NOW(), NULL)
        ON DUPLICATE KEY UPDATE codice = VALUES(codice), esterno = NULL, collegatoAt = NULL, createdAt = NOW()`);
      const c = canali();
      res.json({ codice, ...c,
        url: canale === "telegram"
          ? (c.telegramBot ? `https://t.me/${c.telegramBot}?start=${codice}` : "")
          : (c.whatsappNumero ? `https://wa.me/${c.whatsappNumero.replace(/^\+/, "")}?text=${encodeURIComponent("COLLEGA " + codice)}` : "") });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  app.get("/api/focuslock/agent/chat/link", async (req: Request, res: Response) => {
    const who = await utente(req, res); if (!who) return;
    try {
      await ensureTables();
      const lista = await rows(sql`SELECT canale, codice, collegatoAt FROM focuslock_agent_links WHERE googleSub = ${who.sub}`);
      const out: Record<string, { collegato: boolean; codice: string | null }> = {};
      for (const l of lista) out[String(l.canale)] = { collegato: !!l.collegatoAt, codice: l.collegatoAt ? null : (l.codice ?? null) };
      res.json({ canali: out, ...canali() });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  app.delete("/api/focuslock/agent/chat/link/:canale", async (req: Request, res: Response) => {
    const who = await utente(req, res); if (!who) return;
    const canale = String(req.params.canale || "");
    try {
      await ensureTables();
      await rows(sql`DELETE FROM focuslock_agent_links WHERE googleSub = ${who.sub} AND canale = ${canale}`);
      res.json({ removed: true });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* ---- il lavoratore sul VPS, con il segreto ---- */
  app.get("/api/focuslock/agent/chat/pending", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      await ensureTables();
      /* i messaggi rimasti «in lavoro» da più di dieci minuti tornano in attesa: il lavoratore
       * può essere caduto a metà, e un messaggio senza risposta è peggio di una risposta tarda */
      await rows(sql`UPDATE focuslock_agent_msgs SET stato = 'attesa'
        WHERE stato = 'lavoro' AND createdAt < (NOW() - INTERVAL 10 MINUTE)`);
      const lista = await rows(sql`SELECT id, googleSub, email, canale, testo, createdAt FROM focuslock_agent_msgs
        WHERE direzione = 'in' AND stato = 'attesa' ORDER BY id ASC LIMIT 5`);
      const out: any[] = [];
      for (const m of lista) {
        await rows(sql`UPDATE focuslock_agent_msgs SET stato = 'lavoro' WHERE id = ${m.id} AND stato = 'attesa'`);
        const prof = await rows(sql`SELECT nome, brief FROM focuslock_agent_profilo WHERE googleSub = ${m.googleSub} LIMIT 1`);
        const storico = await rows(sql`SELECT direzione, testo FROM focuslock_agent_msgs
          WHERE googleSub = ${m.googleSub} AND id < ${m.id} AND stato <> 'errore' ORDER BY id DESC LIMIT 12`);
        const link = await rows(sql`SELECT esterno FROM focuslock_agent_links
          WHERE googleSub = ${m.googleSub} AND canale = ${m.canale} AND collegatoAt IS NOT NULL LIMIT 1`);
        out.push({ id: Number(m.id), canale: m.canale, testo: m.testo, email: m.email,
          nome: prof[0]?.nome || "Genio", brief: prof[0]?.brief || "",
          storico: storico.reverse().map((s: any) => ({ direzione: s.direzione, testo: s.testo })),
          esterno: link[0]?.esterno || null });
      }
      res.json({ messaggi: out });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  app.post("/api/focuslock/agent/chat/reply", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    const body = req.body ?? {};
    const id = Number(body.id || 0);
    const testo = pulisci(body.testo, 8000);
    if (!id || !testo) { res.status(400).json({ error: "id and testo are required" }); return; }
    try {
      await ensureTables();
      const orig = await rows(sql`SELECT googleSub, email, canale FROM focuslock_agent_msgs WHERE id = ${id} AND direzione = 'in' LIMIT 1`);
      if (!orig.length) { res.status(404).json({ error: "message not found" }); return; }
      const o = orig[0];
      const azioni = body.azioni && typeof body.azioni === "object" ? body.azioni : null;
      const outId = await inserisci(String(o.googleSub), o.email ?? null, o.canale as Canale, "out", testo, azioni, id, "fatto");
      await rows(sql`UPDATE focuslock_agent_msgs SET stato = 'fatto' WHERE id = ${id}`);
      let consegnato = false;
      if (o.canale === "whatsapp") {
        const link = await rows(sql`SELECT esterno FROM focuslock_agent_links
          WHERE googleSub = ${String(o.googleSub)} AND canale = 'whatsapp' AND collegatoAt IS NOT NULL LIMIT 1`);
        if (link[0]?.esterno) consegnato = await mandaWhatsapp(String(link[0].esterno),
          testo + (azioni && (azioni as any).piano ? "\n\n(La roadmap proposta la trovi nell'app, con il pulsante «Applica».)" : ""));
      }
      res.json({ saved: true, id: outId, consegnato });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* Un messaggio che arriva da un canale esterno: con un codice aggancia la chat all'account;
   * senza, va in coda come se l'utente l'avesse scritto nell'app. */
  app.post("/api/focuslock/agent/chat/inbound", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const esito = await arrivato(req.body ?? {});
      res.status(esito.status).json(esito.body);
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* ---- WhatsApp Cloud API (Meta): la verifica e i messaggi ---- */
  app.get("/api/focuslock/agent/whatsapp", (req: Request, res: Response) => {
    const verify = process.env.WHATSAPP_VERIFY_TOKEN;
    if (verify && req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === verify) {
      res.status(200).send(String(req.query["hub.challenge"] || "")); return;
    }
    res.status(403).end();
  });
  app.post("/api/focuslock/agent/whatsapp", async (req: Request, res: Response) => {
    res.status(200).json({ ok: true });          // Meta vuole il 200 subito, poi si lavora
    try {
      const entry = (req.body ?? {}).entry || [];
      for (const e of entry) for (const ch of (e.changes || [])) {
        const v = ch.value || {};
        for (const m of (v.messages || [])) {
          if (m.type !== "text") continue;
          const from = String(m.from || ""), testo = pulisci(m.text?.body);
          if (!from || !testo) continue;
          const cod = /^\s*COLLEGA\s+([A-Z0-9]{6})\s*$/i.exec(testo);
          const esito = await arrivato(cod ? { canale: "whatsapp", esterno: from, codice: cod[1].toUpperCase() } : { canale: "whatsapp", esterno: from, testo });
          if (esito.body.collegato) await mandaWhatsapp(from, `Collegato. Da qui parli con ${esito.body.nome || "il tuo agente"}: scrivi quando vuoi.`);
          else if (esito.body.sconosciuto) await mandaWhatsapp(from, "Questo numero non è ancora collegato a un account. Apri Focus2Dream → Il tuo agente → Collega WhatsApp.");
        }
      }
    } catch (e: any) { console.warn("[focuslock-chat] whatsapp:", e?.message || e); }
  });
}

async function arrivato(body: any): Promise<{ status: number; body: any }> {
  await ensureTables();
  const canale = String(body.canale || "");
  const esterno = pulisci(body.esterno, 64);
  if ((canale !== "telegram" && canale !== "whatsapp") || !esterno) return { status: 400, body: { error: "canale and esterno are required" } };
  const codice = pulisci(body.codice, 12).toUpperCase();
  if (codice) {
    const l = await rows(sql`SELECT id, googleSub, email FROM focuslock_agent_links
      WHERE canale = ${canale} AND codice = ${codice} AND collegatoAt IS NULL AND createdAt > (NOW() - INTERVAL 1 DAY) LIMIT 1`);
    if (!l.length) return { status: 200, body: { collegato: false, sconosciuto: true } };
    /* lo stesso telefono può appartenere a un account solo: l'aggancio nuovo sgancia il vecchio */
    await rows(sql`UPDATE focuslock_agent_links SET esterno = NULL, collegatoAt = NULL WHERE canale = ${canale} AND esterno = ${esterno}`);
    await rows(sql`UPDATE focuslock_agent_links SET esterno = ${esterno}, collegatoAt = NOW(), codice = NULL WHERE id = ${l[0].id}`);
    const prof = await rows(sql`SELECT nome FROM focuslock_agent_profilo WHERE googleSub = ${String(l[0].googleSub)} LIMIT 1`);
    return { status: 200, body: { collegato: true, nome: prof[0]?.nome || "Genio" } };
  }
  const testo = pulisci(body.testo);
  if (!testo) return { status: 400, body: { error: "testo or codice is required" } };
  const l = await rows(sql`SELECT googleSub, email FROM focuslock_agent_links
    WHERE canale = ${canale} AND esterno = ${esterno} AND collegatoAt IS NOT NULL LIMIT 1`);
  if (!l.length) return { status: 200, body: { sconosciuto: true } };
  const sub = String(l[0].googleSub), email = l[0].email ?? null;
  if (!ammesso(email)) return { status: 200, body: { sconosciuto: true } };
  if ((await scrittiOggi(sub)) >= MAX_AL_GIORNO) return { status: 200, body: { limite: true } };
  const id = await inserisci(sub, email, canale as Canale, "in", testo, null, null, "attesa");
  return { status: 200, body: { id } };
}
