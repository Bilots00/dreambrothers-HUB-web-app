import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import sharp from "sharp";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

/* DreamBrothers — Tee Studio: "Genera il tuo design con l'AI" (come Custom Ink AI Design e il Motivo dell'IA di Spreadshirt).
 *
 * POST /api/tee-designs/generate  {prompt, style?, locale?}  ->  {images:[{url,w,h}]}
 *   - 2 immagini PNG con sfondo trasparente, lato lungo >= 1024 px, soggetto centrato, pronte per la stampa DTG.
 *   - 429 {error:"rate_limited", retryAfter}  oltre il limite per IP (6 generazioni l'ora) o il tetto giornaliero del server.
 *   - 400 {error:"empty_prompt" | "prompt_not_allowed"}.
 *   - 503 {error:"ai_unavailable"} se il motore non risponde (chiave senza fatturazione, quota finita): il tema nasconde
 *     la scheda o dice che non e' disponibile, senza promettere niente.
 * GET /api/tee-designs/ai/:id.png  ->  il PNG salvato (URL stabile, id non indovinabile).
 *
 * IL MOTORE: Gemini immagini con la stessa chiave del ritratto dell'Io Futuro (DREAMMAP_GEMINI_KEY), stessa lista di modelli.
 * IL CONTO (listino ai.google.dev/gemini-api/docs/pricing, come in focuslockRitratto.ts; i modelli immagini NON hanno piano
 * gratuito): gemini-nano-banana-2.1 = 0,0336 $ a immagine 1K, riserva gemini-3.1-flash-image = 0,067 $.
 *   Una generazione = 2 immagini = circa 0,07 $. Tetto di serie TEE_AI_DAILY_MAX = 150 immagini al giorno (circa 5 $ al
 *   giorno, 150 $ al mese nel caso peggiore). Al tetto: 429 fino a mezzanotte UTC. Per IP: TEE_AI_PER_HOUR (di serie 6).
 * LO SFONDO: si chiede bianco pieno e lo si toglie qui (riempimento dai bordi + bordo morbido + colore decontaminato),
 *   cosi' le parti bianche DENTRO il disegno restano (sulle magliette scure si stampano bianche, come deve essere). */

const ORIGINS = /^https:\/\/([a-z0-9-]+\.)*(dream-brothers\.com|dream-brothers\.it|dreambrothers\.it|aa3csa-zv\.myshopify\.com|shopifypreview\.com)$/i;
const KEY = () => process.env.TEE_AI_GEMINI_KEY || process.env.DREAMMAP_GEMINI_KEY || process.env.AGENT_GEMINI_KEY || process.env.GEMINI_API_KEY || "";
const MODELS = () => String(process.env.TEE_AI_MODELS || "gemini-nano-banana-2.1,gemini-3.1-flash-image").split(",").map((s) => s.trim()).filter(Boolean);
const PER_HOUR = () => Math.max(1, Math.floor(Number(process.env.TEE_AI_PER_HOUR || 6)));
const DAILY_MAX = () => Math.max(1, Math.floor(Number(process.env.TEE_AI_DAILY_MAX || 150)));
const N_IMAGES = () => Math.min(4, Math.max(1, Math.floor(Number(process.env.TEE_AI_IMAGES || 2))));

function cors(req: Request, res: Response, next: NextFunction) {
  const o = String(req.headers.origin || "");
  if (ORIGINS.test(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Expose-Headers", "Retry-After");
  }
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
}

const ipOf = (req: Request) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
const hits = new Map<string, number[]>();
/** secondi da aspettare se l'IP ha gia' fatto PER_HOUR generazioni nell'ultima ora, altrimenti 0 (e la conta) */
function ipWait(ip: string): number {
  const now = Date.now(), H = 3600_000;
  const h = (hits.get(ip) || []).filter((t) => now - t < H);
  if (h.length >= PER_HOUR()) { hits.set(ip, h); return Math.ceil((h[0] + H - now) / 1000); }
  h.push(now); hits.set(ip, h);
  return 0;
}
function ipRefund(ip: string) { const h = hits.get(ip); if (h && h.length) h.pop(); }
const secToMidnightUtc = () => { const d = new Date(); return Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime()) / 1000); };

/* Prompt vietati: contenuti espliciti, odio, violenza grafica, e marchi/personaggi protetti (non si possono stampare). */
const BLOCK = [
  /\b(nud[eio]|naked|nsfw|porn\w*|sex\w*|hentai|boobs?|tette|genital\w*|erotic\w*)\b/i,
  /\b(nazi\w*|swastika|svastica|kkk|hitler|isis|terroris\w*)\b/i,
  /\b(gore|decapitat\w*|beheading|mutilat\w*|suicid\w*)\b/i,
  /\b(nike|adidas|puma|gucci|louis\s*vuitton|chanel|supreme|disney|pixar|marvel|dc\s*comics|batman|superman|spider-?man|mickey|pok[eé]mon|pikachu|nintendo|mario|star\s*wars|harry\s*potter|hello\s*kitty|coca[-\s]?cola|ferrari|juventus|real\s*madrid|barcelona|nba|nfl|fifa|uefa)\b/i,
];

const STYLES: Record<string, string> = {
  illustration: "detailed vector illustration, bold clean outlines, limited flat color palette",
  vintage: "vintage retro badge, distressed screen-print look, muted warm colors, circular or shield emblem",
  minimal: "minimalist line art, single color, lots of negative space, simple geometric shapes",
  streetwear: "bold streetwear graphic, high contrast, graffiti and urban energy, thick lines",
  lettering: "typographic design, hand lettering, the words are the main subject, spelled exactly as written",
};

function buildPrompt(prompt: string, style: string, n: number): string {
  const st = STYLES[style] || "clean vector illustration, bold outlines, vivid flat colors";
  return [
    `Create an original T-shirt print graphic: ${prompt}.`,
    `Style: ${st}.`,
    "The artwork is isolated on a perfectly flat, solid pure white (#FFFFFF) background, with nothing else: no T-shirt, no mockup, no person, no frame, no shadow on the background, no paper texture.",
    "Subject centered, fully inside the canvas with generous empty margin on every side, crisp edges suitable for direct-to-garment printing.",
    "Any text must be spelled exactly as given, in English letters, large and legible. No watermark, no signature, no brand logos.",
    n > 1 ? `Variation ${n}: use a noticeably different composition.` : "",
  ].filter(Boolean).join(" ");
}

type Gen = { ok: true; buf: Buffer; model: string } | { ok: false; status: number; reason: string; off: boolean };

async function gemini(text: string): Promise<Gen> {
  const key = KEY();
  if (!key) return { ok: false, status: 503, reason: "no key", off: true };
  let last: Gen = { ok: false, status: 502, reason: "no model", off: false };
  for (const model of MODELS()) {
    let r: globalThis.Response;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "1K" } },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (e: any) { last = { ok: false, status: 504, reason: `${model}: ${e?.message || e}`, off: false }; continue; }
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = String(j?.error?.message || r.status).slice(0, 200);
      // 429/403 di quota o fatturazione: il motore e' spento per questa chiave
      last = { ok: false, status: r.status, reason: `${model}: ${msg}`, off: r.status === 429 || r.status === 403 };
      continue;
    }
    const parts: any[] = j?.candidates?.[0]?.content?.parts || [];
    const d = parts.map((p) => p.inlineData || p.inline_data).find((x) => x && x.data);
    if (d) return { ok: true, buf: Buffer.from(String(d.data), "base64"), model };
    const why = String(j?.candidates?.[0]?.finishReason || j?.promptFeedback?.blockReason || "?");
    last = { ok: false, status: /SAFETY|BLOCK|PROHIBITED/i.test(why) ? 400 : 502, reason: `${model}: no image (${why})`, off: false };
    if (last.status === 400) return last; // bloccato per contenuto: inutile provare il modello di riserva
  }
  return last;
}

/** Toglie lo sfondo chiaro collegato ai bordi, ammorbidisce il contorno, ritaglia e porta il lato lungo a >= 1024 px. */
export async function cutWhite(input: Buffer): Promise<{ png: Buffer; w: number; h: number; transparent: boolean }> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, px = data;
  const N = W * H;
  // colore dello sfondo = mediana dei pixel del bordo (il modello a volte da' un bianco sporco o una carta grigia)
  const border: number[] = [];
  for (let x = 0; x < W; x += 2) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y += 2) border.push(y * W, y * W + W - 1);
  const med = (c: number) => { const v = border.map((i) => px[i * 4 + c]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const BR = med(0), BG = med(1), BB = med(2);
  const dist = (i: number) => { const o = i * 4; return Math.max(Math.abs(px[o] - BR), Math.abs(px[o + 1] - BG), Math.abs(px[o + 2] - BB)); };
  const bd = border.map(dist).sort((a, b) => a - b);
  const light = Math.min(BR, BG, BB) >= 170; // si toglie solo uno sfondo chiaro: uno scuro e' parte del disegno
  const TOL = Math.min(72, Math.max(30, Math.round(bd[Math.floor(bd.length * 0.9)] * 1.6 + 12)));
  // 1) riempimento dai bordi: pixel vicini al colore dello sfondo e collegati al bordo = sfondo
  const bg = new Uint8Array(N);
  const stack: number[] = [];
  const push = (i: number) => { if (!bg[i] && light && dist(i) <= TOL) { bg[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop()!, x = i % W, y = (i / W) | 0;
    if (x > 0) push(i - 1); if (x < W - 1) push(i + 1);
    if (y > 0) push(i - W); if (y < H - 1) push(i + W);
  }
  let bgCount = 0; for (let i = 0; i < N; i++) bgCount += bg[i];
  // sfondo quasi assente (il modello ha riempito tutto) o quasi tutto (disegno bianco su bianco): si restituisce com'e'
  if (bgCount < N * 0.04 || bgCount > N * 0.985) {
    const png = await sharp(input).resize({ width: Math.max(1024, W), withoutEnlargement: false }).png().toBuffer();
    const m = await sharp(png).metadata();
    return { png, w: m.width || W, h: m.height || H, transparent: false };
  }
  // 2) distanza (in pixel, fino a 3) dallo sfondo per il bordo morbido
  const ring = new Uint8Array(N);
  let frontier: number[] = [];
  for (let i = 0; i < N; i++) if (bg[i]) frontier.push(i);
  for (let d = 1; d <= 3; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % W, y = (i / W) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) if (j >= 0 && !bg[j] && !ring[j]) { ring[j] = d; next.push(j); }
    }
    frontier = next;
  }
  // 3) alfa: sfondo trasparente; vicino al bordo alfa = quanto il pixel si allontana dal bianco, colore decontaminato
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    if (bg[i]) { px[o + 3] = 0; continue; }
    if (ring[i]) {
      const r = px[o], g = px[o + 1], b = px[o + 2];
      const a = Math.min(1, Math.max(0, (dist(i) - TOL * 0.5) / (TOL * 1.5)) + (ring[i] - 1) * 0.34);
      if (a < 1) {
        const aa = Math.max(a, 0.02);
        px[o] = Math.max(0, Math.min(255, Math.round((r - (1 - aa) * BR) / aa)));
        px[o + 1] = Math.max(0, Math.min(255, Math.round((g - (1 - aa) * BG) / aa)));
        px[o + 2] = Math.max(0, Math.min(255, Math.round((b - (1 - aa) * BB) / aa)));
      }
      px[o + 3] = Math.round(a * 255);
    }
    if (px[o + 3] > 12) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  // 4) ritaglio con un margine del 3% e lato lungo almeno 1024 px
  const pad = Math.round(Math.max(W, H) * 0.03);
  const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad);
  const cw = Math.min(W, x1 + pad + 1) - left, ch = Math.min(H, y1 + pad + 1) - top;
  let img = sharp(px, { raw: { width: W, height: H, channels: 4 } }).extract({ left, top, width: cw, height: ch });
  const long = Math.max(cw, ch);
  if (long < 1024) img = sharp(await img.png().toBuffer()).resize({ width: Math.round(cw * 1024 / long), height: Math.round(ch * 1024 / long), kernel: "lanczos3" });
  const png = await img.png({ compressionLevel: 9 }).toBuffer();
  const m = await sharp(png).metadata();
  return { png, w: m.width || cw, h: m.height || ch, transparent: true };
}

let ready: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS tee_ai_images (
        id VARCHAR(32) PRIMARY KEY,
        png MEDIUMBLOB NOT NULL,
        w INT NOT NULL,
        h INT NOT NULL,
        prompt VARCHAR(320) NULL,
        style VARCHAR(20) NULL,
        model VARCHAR(60) NULL,
        createdAt TIMESTAMP NULL,
        INDEX idx_created (createdAt)
      )`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}
const rowsOf = (r: any): any[] => (Array.isArray(r) ? (Array.isArray(r[0]) ? r[0] : r) : (r?.rows || []));

async function todayCount(): Promise<number> {
  const db = await getDb();
  const r: any = await db!.execute(sql`SELECT COUNT(*) AS n FROM tee_ai_images WHERE createdAt >= UTC_DATE()`);
  return Number(rowsOf(r)[0]?.n || 0);
}

function baseUrl(req: Request): string {
  const fixed = process.env.PUBLIC_BASE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "");
  return fixed || `${req.protocol}://${req.get("host")}`;
}

export function registerTeeAiRoutes(app: Express) {
  app.use("/api/tee-designs/generate", cors);
  app.use("/api/tee-designs/ai", cors);

  app.post("/api/tee-designs/generate", async (req: Request, res: Response) => {
    const b = req.body ?? {};
    const prompt = String(typeof b.prompt === "string" ? b.prompt : "").replace(/\s+/g, " ").trim().slice(0, 300);
    const style = typeof b.style === "string" && STYLES[b.style] ? b.style : "";
    if (!prompt) { res.status(400).json({ error: "empty_prompt" }); return; }
    if (BLOCK.some((re) => re.test(prompt))) { res.status(400).json({ error: "prompt_not_allowed" }); return; }
    const ip = ipOf(req);
    const wait = ipWait(ip);
    if (wait) { res.setHeader("Retry-After", String(wait)); res.status(429).json({ error: "rate_limited", retryAfter: wait }); return; }
    const n = N_IMAGES();
    try {
      await ensureTable();
      if ((await todayCount()) + n > DAILY_MAX()) {
        ipRefund(ip);
        const s = secToMidnightUtc();
        res.setHeader("Retry-After", String(s)); res.status(429).json({ error: "rate_limited", retryAfter: s }); return;
      }
      const gens = await Promise.all(Array.from({ length: n }, (_, k) => gemini(buildPrompt(prompt, style, k + 1))));
      const good = gens.filter((g): g is Extract<Gen, { ok: true }> => g.ok);
      if (!good.length) {
        ipRefund(ip);
        const g = gens[0] as Extract<Gen, { ok: false }>;
        console.warn("[tee-ai] nessuna immagine:", gens.map((x: any) => x.reason).join(" | "));
        if (g.status === 400) { res.status(400).json({ error: "prompt_not_allowed" }); return; }
        res.status(503).json({ error: "ai_unavailable" }); return;
      }
      const db = await getDb();
      const base = baseUrl(req);
      const images: { url: string; w: number; h: number }[] = [];
      for (const g of good) {
        const cut = await cutWhite(g.buf);
        const id = "a" + crypto.randomBytes(12).toString("base64url");
        await db!.execute(sql`INSERT INTO tee_ai_images (id, png, w, h, prompt, style, model, createdAt)
          VALUES (${id}, ${cut.png}, ${cut.w}, ${cut.h}, ${prompt}, ${style || null}, ${g.model}, NOW())`);
        images.push({ url: `${base}/api/tee-designs/ai/${id}.png`, w: cut.w, h: cut.h });
      }
      res.json({ images });
    } catch (e: any) {
      ipRefund(ip);
      console.error("[tee-ai]", e?.message || e);
      res.status(500).json({ error: "server_error" });
    }
  });

  app.get("/api/tee-designs/ai/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id || "").replace(/\.png$/, "").slice(0, 32);
    if (!/^a[A-Za-z0-9_-]{8,}$/.test(id)) { res.status(404).end(); return; }
    try {
      await ensureTable();
      const db = await getDb();
      const rows = rowsOf(await db!.execute(sql`SELECT png FROM tee_ai_images WHERE id = ${id}`));
      if (!rows.length) { res.status(404).end(); return; }
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("Access-Control-Allow-Origin", "*"); // il canvas del configuratore la disegna e la esporta per la stampa
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.end(Buffer.from(rows[0].png));
    } catch { res.status(500).end(); }
  });
}
