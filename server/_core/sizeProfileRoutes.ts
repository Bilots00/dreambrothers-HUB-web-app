import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

/* DreamBrothers — guida taglie Premium (versione B, stile Sizekick).
 *
 * 1. POST /api/size-profile: salva il profilo taglie (sesso, altezza, peso, eta', corporatura,
 *    reggiseno) nel metafield cliente custom.size_profile, cosi' la volta dopo il cliente loggato
 *    vede subito la sua taglia. Il tema firma l'id cliente con hmac_sha256 (Liquid, lato server):
 *    senza la firma giusta nessuno puo' scrivere sul profilo di un altro.
 * 2. POST /api/size-feedback: valutazione della guida e feedback sulla vestibilita', in tabella.
 *    GET con x-care-secret per leggerli. */

const ORIGINS = /^https:\/\/([a-z0-9-]+\.)*(dream-brothers\.com|dream-brothers\.it|dreambrothers\.it|aa3csa-zv\.myshopify\.com|shopifypreview\.com)$/i;

function cors(req: Request, res: Response, next: NextFunction) {
  const o = String(req.headers.origin || "");
  if (ORIGINS.test(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
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
  // Chiave dedicata se c'e'; altrimenti derivata dal token Admin (che il tema non vede):
  // nel tema finisce solo questa derivata, mai il token.
  const admin = process.env.SHOPIFY_ADMIN_TOKEN;
  const secret = process.env.SIZE_PROFILE_SECRET
    || (admin ? crypto.createHash("sha256").update("dbsf-size-profile:" + admin).digest("hex") : "");
  if (!secret || !sig) return false;
  const expected = crypto.createHmac("sha256", secret).update(customerId).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(String(sig).toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const num = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10) / 10 : null;
};

function cleanProfile(p: any) {
  return {
    sex: p?.sex === "female" ? "female" : "male",
    h: num(p?.h, 100, 250),
    w: num(p?.w, 25, 300),
    age: num(p?.age, 10, 110),
    shape: num(p?.shape, 0, 8),
    unit: p?.unit === "imperial" ? "imperial" : "metric",
    region: typeof p?.region === "string" ? p.region.slice(0, 4) : null,
    bra: p?.bra && typeof p.bra === "object"
      ? { std: String(p.bra.std || "").slice(0, 8), band: String(p.bra.band || "").slice(0, 6), cup: String(p.bra.cup || "").slice(0, 4) }
      : null,
    savedAt: new Date().toISOString(),
  };
}

const hits = new Map<string, number[]>();
function tooMany(ip: string, max = 20): boolean {
  const now = Date.now();
  const h = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (h.length >= max) { hits.set(ip, h); return true; }
  h.push(now); hits.set(ip, h);
  return false;
}

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS size_guide_feedback (
        id INT AUTO_INCREMENT PRIMARY KEY,
        kind VARCHAR(16) NOT NULL,
        rating TINYINT NULL,
        fit VARCHAR(32) NULL,
        comment TEXT NULL,
        product VARCHAR(191) NULL,
        size VARCHAR(16) NULL,
        recommended VARCHAR(16) NULL,
        variant VARCHAR(24) NULL,
        createdAt TIMESTAMP NULL
      )`);
    })().catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

export function registerSizeProfileRoutes(app: Express) {
  app.use(["/api/size-profile", "/api/size-feedback"], cors);

  app.post("/api/size-profile", async (req: Request, res: Response) => {
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    if (tooMany(ip)) { res.status(429).json({ error: "too many" }); return; }
    const b = req.body ?? {};
    const id = String(b.customer_id || "").replace(/\D/g, "");
    if (!id || !validSig(id, String(b.sig || ""))) { res.status(401).json({ error: "bad signature" }); return; }
    const profile = cleanProfile(b.profile);
    if (!profile.h || !profile.w) { res.status(400).json({ error: "profilo incompleto" }); return; }
    try {
      const d = await admin<any>(
        `mutation($m: [MetafieldsSetInput!]!){ metafieldsSet(metafields: $m){ userErrors { field message } } }`,
        { m: [{ ownerId: `gid://shopify/Customer/${id}`, namespace: "custom", key: "size_profile", type: "json", value: JSON.stringify(profile) }] },
      );
      const errs = d?.metafieldsSet?.userErrors || [];
      if (errs.length) { res.status(400).json({ error: errs[0].message }); return; }
      res.json({ saved: true, profile });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.post("/api/size-feedback", async (req: Request, res: Response) => {
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    if (tooMany(ip, 10)) { res.status(429).json({ error: "too many" }); return; }
    const b = req.body ?? {};
    const kind = b.kind === "fit" ? "fit" : "rating";
    try {
      await ensureTable();
      const db = await getDb();
      await db!.execute(sql`INSERT INTO size_guide_feedback (kind, rating, fit, comment, product, size, recommended, variant, createdAt)
        VALUES (${kind}, ${num(b.rating, 1, 5)}, ${b.fit ? String(b.fit).slice(0, 32) : null}, ${b.comment ? String(b.comment).slice(0, 2000) : null},
        ${b.product ? String(b.product).slice(0, 191) : null}, ${b.size ? String(b.size).slice(0, 16) : null},
        ${b.recommended ? String(b.recommended).slice(0, 16) : null}, ${b.variant ? String(b.variant).slice(0, 24) : null}, NOW())`);
      res.json({ sent: true });
    } catch (e: any) {
      res.status(500).json({ error: "db: " + (e?.message || String(e)) });
    }
  });

  app.get("/api/size-feedback", async (req: Request, res: Response) => {
    const expected = process.env.CARE_WEBHOOK_SECRET;
    if (!expected || req.headers["x-care-secret"] !== expected) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      await ensureTable();
      const db = await getDb();
      const r: any = await db!.execute(sql`SELECT * FROM size_guide_feedback ORDER BY id DESC LIMIT 500`);
      res.json({ feedback: Array.isArray(r) ? r[0] : r });
    } catch (e: any) {
      res.status(500).json({ error: "db: " + (e?.message || String(e)) });
    }
  });
}
