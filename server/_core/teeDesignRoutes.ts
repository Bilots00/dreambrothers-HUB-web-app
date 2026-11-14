import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

/* DreamBrothers — Tee Studio (configuratore magliette del tema).
 *
 * "I tuoi design" come su Nike By You: il cliente loggato salva i suoi design sul profilo.
 * - Lo stato completo (livelli, testi, immagini ridotte) sta nella tabella tee_designs.
 * - L'elenco leggero (id, nome, colore, data) va nel metafield cliente custom.tee_designs,
 *   cosi' il tema lo stampa subito in Liquid senza chiamate.
 * - Firma: la stessa del profilo taglie (hmac_sha256 dell'id cliente con la chiave derivata),
 *   quindi nessuno scrive sul profilo di un altro.
 * - /share: salvataggio anonimo per link condivisibili e per aprire l'AR sul telefono (QR).
 */

const ORIGINS = /^https:\/\/([a-z0-9-]+\.)*(dream-brothers\.com|dream-brothers\.it|dreambrothers\.it|aa3csa-zv\.myshopify\.com|shopifypreview\.com)$/i;
const MAX_STATE = 6 * 1024 * 1024;   // stato con immagini ridotte
const MAX_THUMB = 900 * 1024;        // anteprima webp/png
const MAX_PER_CUSTOMER = 40;

function cors(req: Request, res: Response, next: NextFunction) {
  const o = String(req.headers.origin || "");
  if (ORIGINS.test(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
}

async function admin<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) throw new Error("Mancano SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN");
  const url = `https://${String(shop).replace(/^https?:\/\//, "").replace(/\/$/, "")}`
    + `/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-04"}/graphql.json`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j: any = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data as T;
}

function validSig(customerId: string, sig: string): boolean {
  const adminTok = process.env.SHOPIFY_ADMIN_TOKEN;
  const secret = process.env.SIZE_PROFILE_SECRET
    || (adminTok ? crypto.createHash("sha256").update("dbsf-size-profile:" + adminTok).digest("hex") : "");
  if (!secret || !sig) return false;
  const expected = crypto.createHmac("sha256", secret).update(customerId).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(String(sig).toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const hits = new Map<string, number[]>();
function tooMany(key: string, max: number, windowMs = 10 * 60 * 1000): boolean {
  const now = Date.now();
  const h = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (h.length >= max) { hits.set(key, h); return true; }
  h.push(now); hits.set(key, h);
  return false;
}
const ipOf = (req: Request) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
const newId = () => crypto.randomBytes(12).toString("base64url");
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS tee_designs (
        id VARCHAR(32) PRIMARY KEY,
        customer VARCHAR(24) NULL,
        name VARCHAR(120) NULL,
        color VARCHAR(40) NULL,
        state MEDIUMTEXT NOT NULL,
        thumb MEDIUMBLOB NULL,
        thumbType VARCHAR(24) NULL,
        createdAt TIMESTAMP NULL,
        updatedAt TIMESTAMP NULL,
        INDEX idx_customer (customer)
      )`);
    })().catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

function parseThumb(dataUrl: unknown): { buf: Buffer; type: string } | null {
  const m = /^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_THUMB) return null;
  return { buf, type: m[1] };
}

function cleanState(s: unknown): string | null {
  if (!s || typeof s !== "object") return null;
  const json = JSON.stringify(s);
  return json.length <= MAX_STATE ? json : null;
}

async function listFor(customer: string) {
  const db = await getDb();
  const r: any = await db!.execute(sql`SELECT id, name, color, updatedAt FROM tee_designs WHERE customer = ${customer} ORDER BY updatedAt DESC LIMIT ${MAX_PER_CUSTOMER}`);
  const rows = Array.isArray(r) ? (Array.isArray(r[0]) ? r[0] : r) : (r?.rows || []);
  return rows.map((x: any) => ({ id: x.id, name: x.name || "", color: x.color || "", at: new Date(x.updatedAt).toISOString() }));
}

async function syncMetafield(customer: string, list: any[]) {
  const d = await admin<any>(
    `mutation($m: [MetafieldsSetInput!]!){ metafieldsSet(metafields: $m){ userErrors { field message } } }`,
    { m: [{ ownerId: `gid://shopify/Customer/${customer}`, namespace: "custom", key: "tee_designs", type: "json", value: JSON.stringify({ v: 1, designs: list }) }] },
  );
  const errs = d?.metafieldsSet?.userErrors || [];
  if (errs.length) throw new Error(errs[0].message);
}

function auth(req: Request, res: Response): string | null {
  const b = req.body ?? {};
  const id = String(b.customer_id || "").replace(/\D/g, "");
  if (!id || !validSig(id, String(b.sig || ""))) { res.status(401).json({ error: "bad signature" }); return null; }
  return id;
}

export function registerTeeDesignRoutes(app: Express) {
  app.use("/api/tee-designs", cors);

  // salva (crea o aggiorna) un design del cliente loggato
  app.post("/api/tee-designs/save", async (req: Request, res: Response) => {
    if (tooMany("s:" + ipOf(req), 60)) { res.status(429).json({ error: "too many" }); return; }
    const customer = auth(req, res); if (!customer) return;
    const d = req.body?.design ?? {};
    const state = cleanState(d.state);
    if (!state) { res.status(400).json({ error: "design troppo grande o vuoto" }); return; }
    const thumb = parseThumb(d.thumb);
    try {
      await ensureTable();
      const db = await getDb();
      let id = str(d.id, 32).replace(/[^A-Za-z0-9_-]/g, "");
      if (id) {
        const r: any = await db!.execute(sql`SELECT customer FROM tee_designs WHERE id = ${id}`);
        const rows = Array.isArray(r) ? (Array.isArray(r[0]) ? r[0] : r) : [];
        if (!rows.length || String(rows[0].customer) !== customer) id = "";
      }
      if (id) {
        await db!.execute(sql`UPDATE tee_designs SET name = ${str(d.name, 120)}, color = ${str(d.color, 40)}, state = ${state},
          thumb = COALESCE(${thumb ? thumb.buf : null}, thumb), thumbType = COALESCE(${thumb ? thumb.type : null}, thumbType), updatedAt = NOW() WHERE id = ${id}`);
      } else {
        const count: any = await db!.execute(sql`SELECT COUNT(*) AS n FROM tee_designs WHERE customer = ${customer}`);
        const n = Number((Array.isArray(count) ? (Array.isArray(count[0]) ? count[0] : count) : [])[0]?.n || 0);
        if (n >= MAX_PER_CUSTOMER) { res.status(409).json({ error: `Hai gia' ${MAX_PER_CUSTOMER} design salvati: eliminane uno per salvarne un altro.` }); return; }
        id = newId();
        await db!.execute(sql`INSERT INTO tee_designs (id, customer, name, color, state, thumb, thumbType, createdAt, updatedAt)
          VALUES (${id}, ${customer}, ${str(d.name, 120)}, ${str(d.color, 40)}, ${state}, ${thumb ? thumb.buf : null}, ${thumb ? thumb.type : null}, NOW(), NOW())`);
      }
      const list = await listFor(customer);
      await syncMetafield(customer, list);
      res.json({ saved: true, id, designs: list });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.post("/api/tee-designs/list", async (req: Request, res: Response) => {
    if (tooMany("l:" + ipOf(req), 120)) { res.status(429).json({ error: "too many" }); return; }
    const customer = auth(req, res); if (!customer) return;
    try { await ensureTable(); res.json({ designs: await listFor(customer) }); }
    catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });

  app.post("/api/tee-designs/get", async (req: Request, res: Response) => {
    if (tooMany("g:" + ipOf(req), 200)) { res.status(429).json({ error: "too many" }); return; }
    const customer = auth(req, res); if (!customer) return;
    const id = str(req.body?.id, 32);
    try {
      await ensureTable();
      const db = await getDb();
      const r: any = await db!.execute(sql`SELECT id, name, color, state FROM tee_designs WHERE id = ${id} AND customer = ${customer}`);
      const rows = Array.isArray(r) ? (Array.isArray(r[0]) ? r[0] : r) : [];
      if (!rows.length) { res.status(404).json({ error: "non trovato" }); return; }
      res.json({ id: rows[0].id, name: rows[0].name, color: rows[0].color, state: JSON.parse(rows[0].state) });
    } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });

  app.post("/api/tee-designs/delete", async (req: Request, res: Response) => {
    if (tooMany("d:" + ipOf(req), 60)) { res.status(429).json({ error: "too many" }); return; }
    const customer = auth(req, res); if (!customer) return;
    const id = str(req.body?.id, 32);
    try {
      await ensureTable();
      const db = await getDb();
      await db!.execute(sql`DELETE FROM tee_designs WHERE id = ${id} AND customer = ${customer}`);
      const list = await listFor(customer);
      await syncMetafield(customer, list);
      res.json({ deleted: true, designs: list });
    } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });

  // link condivisibile e passaggio AR al telefono: salvataggio anonimo, id non indovinabile
  app.post("/api/tee-designs/share", async (req: Request, res: Response) => {
    if (tooMany("sh:" + ipOf(req), 20)) { res.status(429).json({ error: "too many" }); return; }
    const d = req.body?.design ?? {};
    const state = cleanState(d.state);
    if (!state) { res.status(400).json({ error: "design troppo grande o vuoto" }); return; }
    const thumb = parseThumb(d.thumb);
    try {
      await ensureTable();
      const db = await getDb();
      const id = "p" + newId();
      await db!.execute(sql`INSERT INTO tee_designs (id, customer, name, color, state, thumb, thumbType, createdAt, updatedAt)
        VALUES (${id}, NULL, ${str(d.name, 120)}, ${str(d.color, 40)}, ${state}, ${thumb ? thumb.buf : null}, ${thumb ? thumb.type : null}, NOW(), NOW())`);
      res.json({ id });
    } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });

  app.get("/api/tee-designs/public/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id || "").slice(0, 32);
    if (!/^p[A-Za-z0-9_-]{8,}$/.test(id)) { res.status(404).json({ error: "non trovato" }); return; }
    try {
      await ensureTable();
      const db = await getDb();
      const r: any = await db!.execute(sql`SELECT id, name, color, state FROM tee_designs WHERE id = ${id}`);
      const rows = Array.isArray(r) ? (Array.isArray(r[0]) ? r[0] : r) : [];
      if (!rows.length) { res.status(404).json({ error: "non trovato" }); return; }
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json({ id, name: rows[0].name, color: rows[0].color, state: JSON.parse(rows[0].state) });
    } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });

  // anteprima: id non indovinabile, nessun dato personale dentro
  app.get("/api/tee-designs/thumb/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id || "").replace(/\.(webp|png|jpe?g)$/, "").slice(0, 32);
    try {
      await ensureTable();
      const db = await getDb();
      const r: any = await db!.execute(sql`SELECT thumb, thumbType FROM tee_designs WHERE id = ${id}`);
      const rows = Array.isArray(r) ? (Array.isArray(r[0]) ? r[0] : r) : [];
      if (!rows.length || !rows[0].thumb) { res.status(404).end(); return; }
      res.setHeader("Content-Type", rows[0].thumbType || "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end(Buffer.from(rows[0].thumb));
    } catch (e: any) { res.status(500).end(); }
  });
}
