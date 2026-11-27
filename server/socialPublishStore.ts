/**
 * Pubblicazione automatica delle bozze social: stato a database, link pubblici
 * alle immagini, ciclo dello scheduler.
 *
 * Regole che questo file tiene ferme:
 *  1. Si pubblica SOLO una bozza che Andrea ha messo in coda dai pulsanti
 *     "Approva e pianifica" / "Pubblica ora" (colonna publishQueuedAt). Le
 *     bozze vecchie gia' in stato `scheduled` prima di questa funzione non
 *     partono da sole al primo deploy.
 *  2. Mai due volte lo stesso post: una bozza si "prenota" con un UPDATE
 *     atomico prima di chiamare Meta, e una pubblicazione interrotta a meta'
 *     non si riprova da sola.
 *  3. Al massimo 3 tentativi, con attesa crescente; gli errori definitivi
 *     (permesso mancante, caption troppo lunga) fermano subito.
 *  4. Il token sta nelle variabili Railway (META_PAGE_ACCESS_TOKEN), come gli
 *     altri segreti dell'Hub: mai nel client, mai nei log.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb, getSocialDraftById, getSocialDraftAssets } from "./db";
import { basePubblica } from "./artworkLink";
import {
  createGraphClient, controllaToken, pubblicaInstagram, pubblicaFacebook, ErrorePubblicazione,
  type EsitoPubblicazione, type GraphClient, type MediaPubblico, type PostDaPubblicare, type StatoToken,
} from "./socialPublish";

export const MAX_TENTATIVI = 3;
export const ATTESA_TRA_TENTATIVI_MS = 10 * 60 * 1000; // 10 min dopo il 1°, 20 dopo il 2°
export const PRENOTAZIONE_SCADUTA_MS = 15 * 60 * 1000;
export const PIATTAFORME_PUBBLICABILI = ["instagram", "facebook"] as const;

// ─── Colonne di pubblicazione ────────────────────────────────────────────────
// Stanno fuori dallo schema drizzle apposta: drizzle mette TUTTE le colonne
// dello schema in ogni INSERT, e una colonna non ancora creata romperebbe
// l'endpoint con cui l'agente notturno scrive le bozze.

const COLONNE: Array<[string, string]> = [
  ["publishQueuedAt", "TIMESTAMP NULL"],
  ["publishAttempts", "INT NOT NULL DEFAULT 0"],
  ["publishLastAttemptAt", "TIMESTAMP NULL"],
  ["publishingStartedAt", "TIMESTAMP NULL"],
  ["publishError", "TEXT NULL"],
  ["publishedPostId", "VARCHAR(128) NULL"],
  ["publishedPermalink", "TEXT NULL"],
  ["publishedAt", "TIMESTAMP NULL"],
];

async function esegui(q: ReturnType<typeof sql>): Promise<any> {
  const db = await getDb();
  if (!db) throw new Error("database non disponibile");
  const res: any = await db.execute(q);
  return Array.isArray(res) ? res[0] : res;
}

async function righe(q: ReturnType<typeof sql>): Promise<any[]> {
  const out = await esegui(q);
  return Array.isArray(out) ? out : [];
}

let pronte: Promise<void> | null = null;
export function ensureColonnePubblicazione(): Promise<void> {
  if (!pronte) {
    pronte = (async () => {
      for (const [nome, tipo] of COLONNE) {
        try {
          await esegui(sql.raw(`ALTER TABLE social_drafts ADD COLUMN ${nome} ${tipo}`));
        } catch (e: any) {
          const why = [e?.code, e?.message, e?.cause?.code, e?.cause?.message].filter(Boolean).join(" ");
          if (!/duplicate column|ER_DUP_FIELDNAME/i.test(why || String(e))) throw e;
        }
      }
    })().catch((e) => { pronte = null; throw e; });
  }
  return pronte;
}

export interface StatoPubblicazione {
  id: number;
  publishQueuedAt: Date | null;
  publishAttempts: number;
  publishLastAttemptAt: Date | null;
  publishingStartedAt: Date | null;
  publishError: string | null;
  publishedPostId: string | null;
  publishedPermalink: string | null;
  publishedAt: Date | null;
}

/** Lo stato di pubblicazione di piu' bozze, per la pagina Bozze. */
export async function statoPubblicazione(ids: number[]): Promise<Map<number, StatoPubblicazione>> {
  const mappa = new Map<number, StatoPubblicazione>();
  const puliti = ids.filter((n) => Number.isInteger(n));
  if (!puliti.length) return mappa;
  await ensureColonnePubblicazione();
  const rs = await righe(sql`SELECT id, publishQueuedAt, publishAttempts, publishLastAttemptAt, publishingStartedAt,
    publishError, publishedPostId, publishedPermalink, publishedAt
    FROM social_drafts WHERE id IN (${sql.join(puliti.map((n) => sql`${n}`), sql`, `)})`);
  for (const r of rs) mappa.set(Number(r.id), { ...r, id: Number(r.id), publishAttempts: Number(r.publishAttempts ?? 0) });
  return mappa;
}

/** "Approva e pianifica" / "Pubblica ora": la bozza entra in coda, i tentativi ripartono da zero. */
export async function mettiInCoda(id: number, quando: Date): Promise<void> {
  await ensureColonnePubblicazione();
  const r = await esegui(sql`UPDATE social_drafts SET status = 'scheduled', scheduledAt = ${quando},
    publishQueuedAt = NOW(), publishAttempts = 0, publishError = NULL, publishLastAttemptAt = NULL
    WHERE id = ${id} AND publishedPostId IS NULL AND publishingStartedAt IS NULL`);
  if (Number(r?.affectedRows ?? 0) !== 1) {
    throw new Error("Questa bozza e' gia' pubblicata o in pubblicazione proprio adesso.");
  }
}

/**
 * Toglie dalla coda. Con `tornaBozza` (il pulsante "Annulla") la rimette anche
 * in stato bozza; senza, lascia lo stato che ha appena scelto Andrea (es.
 * "scartata"). Non tocca mai un post gia' uscito.
 */
export async function togliDallaCoda(id: number, { tornaBozza = true } = {}): Promise<void> {
  await ensureColonnePubblicazione();
  if (tornaBozza) {
    await esegui(sql`UPDATE social_drafts SET status = 'draft', publishQueuedAt = NULL, publishError = NULL
      WHERE id = ${id} AND publishedPostId IS NULL AND publishingStartedAt IS NULL`);
  } else {
    await esegui(sql`UPDATE social_drafts SET publishQueuedAt = NULL
      WHERE id = ${id} AND publishedPostId IS NULL AND publishingStartedAt IS NULL`);
  }
}

// ─── Configurazione dal server ───────────────────────────────────────────────

export interface ConfigMeta {
  token: string;
  pageId: string | null;
  igUserId: string | null;
}

export function configMeta(): ConfigMeta | null {
  const token = (process.env.META_PAGE_ACCESS_TOKEN || "").trim();
  if (!token) return null;
  return {
    token,
    pageId: (process.env.META_PAGE_ID || "").trim() || null,
    igUserId: (process.env.META_IG_USER_ID || "").trim() || null,
  };
}

let cacheStato: { quando: number; stato: StatoToken } | null = null;

/** Il controllo del token per la pagina Bozze (cache 10 minuti, il token non esce mai). */
export async function statoToken(forza = false): Promise<StatoToken> {
  const cfg = configMeta();
  if (!cfg) {
    return {
      configurato: false, valido: false, pagina: null, pageId: null, igUserId: null, igUsername: null,
      permessiMancanti: [], scadeIl: null,
      problemi: ["Manca META_PAGE_ACCESS_TOKEN nelle variabili Railway: la pubblicazione automatica e' spenta."],
    };
  }
  if (!forza && cacheStato && Date.now() - cacheStato.quando < 10 * 60_000) return cacheStato.stato;
  const appId = (process.env.META_APP_ID || "").trim();
  const appSecret = (process.env.META_APP_SECRET || "").trim();
  const graphDebug = appId && appSecret ? createGraphClient(`${appId}|${appSecret}`) : undefined;
  const stato = await controllaToken(createGraphClient(cfg.token), cfg.token, cfg.pageId, { graphDebug });
  if (cfg.igUserId) stato.igUserId = cfg.igUserId;
  cacheStato = { quando: Date.now(), stato };
  return stato;
}

// ─── Link pubblici e firmati alle immagini ───────────────────────────────────
// Instagram scarica l'immagine da un URL pubblico e accetta solo JPEG. Le
// immagini dell'agente sono spesso data URI PNG dentro la colonna `assets`:
// la web app le espone convertite in JPEG su un indirizzo firmato e a scadenza.

const DURATA_LINK_MS = 6 * 60 * 60 * 1000;

function chiaveFirma(): string {
  const k = process.env.CARE_WEBHOOK_SECRET || process.env.JWT_SECRET;
  if (!k) throw new ErrorePubblicazione("Manca CARE_WEBHOOK_SECRET (o JWT_SECRET): non posso firmare i link alle immagini per Meta.", true);
  return k;
}

function firma(id: number, idx: number, exp: number): string {
  return createHmac("sha256", chiaveFirma()).update(`social-media/${id}/${idx}/${exp}`).digest("hex").slice(0, 32);
}

export function linkMedia(id: number, idx: number, ora = Date.now()): string {
  const base = basePubblica();
  if (!base) throw new ErrorePubblicazione("Non so l'indirizzo pubblico dell'Hub (PUBLIC_BASE_URL o RAILWAY_PUBLIC_DOMAIN): Meta non puo' scaricare le immagini.", true);
  const exp = ora + DURATA_LINK_MS;
  return `${base}/api/social/media/${id}/${idx}?exp=${exp}&sig=${firma(id, idx, exp)}`;
}

export function verificaLinkMedia(id: number, idx: number, exp: string, sig: string, ora = Date.now()): boolean {
  const scadenza = Number(exp);
  if (!Number.isFinite(scadenza) || scadenza < ora) return false;
  const a = Buffer.from(firma(id, idx, scadenza));
  const b = Buffer.from(String(sig || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AssetBozza {
  src: string; // data URI o URL http(s)
  tipo: "image" | "video";
}

/** La colonna `assets` in tutte le forme viste: stringa, array di stringhe, array di {url|src|type}. */
export function leggiAsset(grezzo: string | null): AssetBozza[] {
  if (!grezzo) return [];
  let v: unknown;
  try { v = JSON.parse(grezzo); } catch { v = grezzo; }
  const lista = Array.isArray(v) ? v : [v];
  const out: AssetBozza[] = [];
  for (const el of lista) {
    let src: string | undefined;
    let tipoDichiarato = "";
    if (typeof el === "string") src = el;
    else if (el && typeof el === "object") {
      const o = el as Record<string, unknown>;
      src = [o.url, o.src, o.dataUri, o.data].find((x): x is string => typeof x === "string");
      tipoDichiarato = String(o.type ?? o.tipo ?? o.mediaType ?? "");
    }
    if (!src || !/^(data:|https?:\/\/)/i.test(src.trim())) continue;
    src = src.trim();
    const video = /video/i.test(tipoDichiarato) || /^data:video\//i.test(src) || /\.(mp4|mov|m4v)(\?|$)/i.test(src);
    out.push({ src, tipo: video ? "video" : "image" });
  }
  return out;
}

export async function scaricaAsset(src: string): Promise<{ buf: Buffer; mime: string }> {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(src);
  if (m) {
    const mime = m[1] || "application/octet-stream";
    const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
    return { buf, mime };
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error(`asset non scaricabile (HTTP ${res.status})`);
  return { buf: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") || "application/octet-stream" };
}

/** Immagine → JPEG che Instagram accetta (max 1440 px di lato, sotto gli 8 MB). */
export async function inJpeg(buf: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(buf).rotate().resize({ width: 1440, height: 1800, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

export function registerSocialMediaRoute(app: Express) {
  // Pubblico ma firmato: e' Meta che scarica, non Andrea. Senza firma valida, 404.
  app.get("/api/social/media/:id/:idx", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const idx = Number(req.params.idx);
    try {
      if (!Number.isInteger(id) || !Number.isInteger(idx) || !verificaLinkMedia(id, idx, String(req.query.exp ?? ""), String(req.query.sig ?? ""))) {
        res.status(404).send("not found");
        return;
      }
      const asset = leggiAsset(await getSocialDraftAssets(id))[idx];
      if (!asset) { res.status(404).send("not found"); return; }
      const { buf, mime } = await scaricaAsset(asset.src);
      if (asset.tipo === "image") {
        res.set("Content-Type", "image/jpeg").set("Cache-Control", "private, max-age=3600").send(await inJpeg(buf));
      } else {
        res.set("Content-Type", mime.startsWith("video/") ? mime : "video/mp4").set("Cache-Control", "private, max-age=3600").send(buf);
      }
    } catch (e) {
      console.warn(`[social/media] bozza ${id} asset ${idx}:`, e instanceof Error ? e.message : e);
      res.status(500).send("media error");
    }
  });
}

/** Gli URL che Meta scarichera': immagini sempre dal nostro endpoint (JPEG), video http diretti. */
export function mediaPerMeta(id: number, assets: AssetBozza[], ora = Date.now()): MediaPubblico[] {
  return assets.map((a, i) => ({
    tipo: a.tipo,
    url: a.tipo === "video" && /^https:\/\//i.test(a.src) ? a.src : linkMedia(id, i, ora),
  }));
}

// ─── Pubblicazione di una bozza ──────────────────────────────────────────────

let igDaPagina: { pageId: string; igUserId: string } | null = null;

async function risolviIg(graph: GraphClient, cfg: ConfigMeta): Promise<string> {
  if (cfg.igUserId) return cfg.igUserId;
  if (!cfg.pageId) throw new ErrorePubblicazione("Manca META_PAGE_ID (o META_IG_USER_ID) nelle variabili Railway.", true);
  if (igDaPagina?.pageId === cfg.pageId) return igDaPagina.igUserId;
  const p = await graph.get<{ instagram_business_account?: { id: string } }>(`/${cfg.pageId}`, { fields: "instagram_business_account" });
  const ig = p.instagram_business_account?.id;
  if (!ig) throw new ErrorePubblicazione("La Pagina Facebook non ha un account Instagram professionale collegato.", true);
  igDaPagina = { pageId: cfg.pageId, igUserId: ig };
  return ig;
}

/** Pubblica davvero UNA bozza. Chiamata solo dal ciclo, dopo la prenotazione. */
export async function pubblicaBozza(id: number, deps: { graph?: GraphClient; cfg?: ConfigMeta | null } = {}): Promise<EsitoPubblicazione> {
  const cfg = deps.cfg === undefined ? configMeta() : deps.cfg;
  if (!cfg) throw new ErrorePubblicazione("Manca META_PAGE_ACCESS_TOKEN nelle variabili Railway.", true);
  const bozza = await getSocialDraftById(id);
  if (!bozza) throw new ErrorePubblicazione("Bozza non trovata.", true);
  const graph = deps.graph ?? createGraphClient(cfg.token);
  const post: PostDaPubblicare = {
    platform: bozza.platform,
    format: bozza.format,
    caption: bozza.caption,
    hashtags: bozza.hashtags,
    media: mediaPerMeta(id, leggiAsset(await getSocialDraftAssets(id))),
  };
  if (bozza.platform === "instagram") return pubblicaInstagram(graph, await risolviIg(graph, cfg), post);
  if (bozza.platform === "facebook") {
    if (!cfg.pageId) throw new ErrorePubblicazione("Manca META_PAGE_ID nelle variabili Railway.", true);
    return pubblicaFacebook(graph, cfg.pageId, post);
  }
  throw new ErrorePubblicazione(`La pubblicazione automatica copre Instagram e Facebook, non ${bozza.platform}.`, true);
}

// ─── Ciclo dello scheduler ───────────────────────────────────────────────────

export interface BozzaInCoda {
  id: number;
  platform: string;
  publishAttempts: number;
  publishLastAttemptAt: Date | null;
  publishingStartedAt: Date | null;
}

export interface DepsCiclo {
  now(): Date;
  inCoda(now: Date): Promise<BozzaInCoda[]>;
  /** UPDATE atomico: true solo se questa chiamata ha preso la bozza. */
  prenota(id: number): Promise<boolean>;
  pubblica(id: number): Promise<EsitoPubblicazione>;
  segnaPubblicata(id: number, esito: EsitoPubblicazione): Promise<void>;
  segnaErrore(id: number, messaggio: string, tentativi: number): Promise<void>;
  log?(msg: string): void;
}

export interface EsitoCiclo {
  pubblicate: number[];
  fallite: number[];
  saltate: number[];
}

/** Un giro: prende le bozze in coda con data passata e le pubblica una alla volta. */
export async function cicloPubblicazione(deps: DepsCiclo): Promise<EsitoCiclo> {
  const ora = deps.now();
  const esito: EsitoCiclo = { pubblicate: [], fallite: [], saltate: [] };
  const log = deps.log ?? (() => {});

  for (const b of await deps.inCoda(ora)) {
    if (b.publishAttempts >= MAX_TENTATIVI) { esito.saltate.push(b.id); continue; }

    // Prenotata e mai chiusa: il processo e' morto a meta' (deploy, crash).
    // Il post potrebbe essere uscito: non si riprova da soli.
    if (b.publishingStartedAt) {
      if (ora.getTime() - new Date(b.publishingStartedAt).getTime() > PRENOTAZIONE_SCADUTA_MS) {
        await deps.segnaErrore(b.id, "Pubblicazione interrotta a meta' (riavvio del server): controlla il profilo, poi ripianifica se il post non c'e'.", MAX_TENTATIVI);
        esito.fallite.push(b.id);
      } else {
        esito.saltate.push(b.id);
      }
      continue;
    }

    // Attesa crescente tra un tentativo e l'altro.
    if (b.publishAttempts > 0 && b.publishLastAttemptAt
        && ora.getTime() - new Date(b.publishLastAttemptAt).getTime() < b.publishAttempts * ATTESA_TRA_TENTATIVI_MS) {
      esito.saltate.push(b.id);
      continue;
    }

    if (!(await deps.prenota(b.id))) { esito.saltate.push(b.id); continue; }

    try {
      const r = await deps.pubblica(b.id);
      await deps.segnaPubblicata(b.id, r);
      esito.pubblicate.push(b.id);
      log(`bozza ${b.id} (${b.platform}) pubblicata: ${r.permalink ?? r.postId}`);
    } catch (e) {
      const definitivo = e instanceof ErrorePubblicazione && e.definitivo;
      const tentativi = definitivo ? MAX_TENTATIVI : b.publishAttempts + 1;
      let msg = e instanceof Error ? e.message : String(e);
      if (tentativi >= MAX_TENTATIVI && !definitivo) msg = `${msg} — fermata dopo ${MAX_TENTATIVI} tentativi.`;
      await deps.segnaErrore(b.id, msg.slice(0, 1000), tentativi);
      esito.fallite.push(b.id);
      log(`bozza ${b.id} (${b.platform}) tentativo ${tentativi}/${MAX_TENTATIVI} fallito: ${msg}`);
    }
  }
  return esito;
}

/** Le dipendenze vere: MySQL + Graph API. */
export function depsReali(): DepsCiclo {
  return {
    now: () => new Date(),
    async inCoda(now) {
      await ensureColonnePubblicazione();
      const rs = await righe(sql`SELECT id, platform, publishAttempts, publishLastAttemptAt, publishingStartedAt
        FROM social_drafts
        WHERE status = 'scheduled' AND publishQueuedAt IS NOT NULL AND publishedPostId IS NULL
          AND scheduledAt IS NOT NULL AND scheduledAt <= ${now}
          AND publishAttempts < ${MAX_TENTATIVI}
          AND platform IN ('instagram', 'facebook')
        ORDER BY scheduledAt ASC LIMIT 10`);
      return rs.map((r) => ({ ...r, id: Number(r.id), publishAttempts: Number(r.publishAttempts ?? 0) }));
    },
    async prenota(id) {
      const r = await esegui(sql`UPDATE social_drafts SET publishingStartedAt = NOW(), publishLastAttemptAt = NOW()
        WHERE id = ${id} AND status = 'scheduled' AND publishingStartedAt IS NULL AND publishedPostId IS NULL`);
      return Number(r?.affectedRows ?? 0) === 1;
    },
    pubblica: (id) => pubblicaBozza(id),
    async segnaPubblicata(id, esito) {
      await esegui(sql`UPDATE social_drafts SET status = 'published', publishedPostId = ${esito.postId},
        publishedPermalink = ${esito.permalink}, publishedAt = NOW(), publishingStartedAt = NULL, publishError = NULL
        WHERE id = ${id}`);
    },
    async segnaErrore(id, messaggio, tentativi) {
      await esegui(sql`UPDATE social_drafts SET publishError = ${messaggio}, publishAttempts = ${tentativi},
        publishingStartedAt = NULL WHERE id = ${id}`);
    },
    log: (m) => console.log(`[Scheduler] social-publish: ${m}`),
  };
}

let inCorso: Promise<EsitoCiclo> | null = null;
let ancoraUnGiro = false;

/**
 * Il giro vero. Due giri non si sovrappongono mai (un Reel puo' metterci
 * minuti); se arriva un "Pubblica ora" mentre un giro e' in corso, ne parte
 * subito un altro appena finisce, invece di aspettare i 5 minuti.
 */
export function eseguiCicloPubblicazione(): Promise<EsitoCiclo> {
  if (!configMeta()) return Promise.resolve({ pubblicate: [], fallite: [], saltate: [] });
  if (inCorso) {
    ancoraUnGiro = true;
    return inCorso;
  }
  inCorso = cicloPubblicazione(depsReali()).finally(() => {
    inCorso = null;
    if (ancoraUnGiro) {
      ancoraUnGiro = false;
      void eseguiCicloPubblicazione().catch((e) => console.warn("[Scheduler] social-publish fallito:", e));
    }
  });
  return inCorso;
}
