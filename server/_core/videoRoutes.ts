import type { Express, Request, Response } from "express";
import {
  insertVideoDraft,
  getVideoDraftsForUser,
  getAllUserSettings,
  upsertUserSetting,
} from "../db";

// Video Editing — superficie server-to-server per l'agente notturno "Video Editor".
//
// Stesso modello di socialRoutes.ts (che serve l'agente SMM): la web app e' il
// pannello e il magazzino, l'agente gira altrove (VPS o PC) e parla solo con
// queste rotte, protette dal medesimo CARE_WEBHOOK_SECRET — un solo segreto per
// tutti gli agenti, come gia' deciso per Care e Social.
//
// Il flusso di una notte:
//   1. GET  /api/video/config     l'interruttore e' acceso? con che motore, quanti video?
//   2. GET  /api/video/brief      materia prima: angoli, prodotti, reference, hook GIA' usati
//   3. POST /api/video/draft      consegna: un record per creative, status "draft"
//   4. POST /api/video/heartbeat  cosi' la pagina sa se l'agente e' vivo
//
// Nulla di quello che arriva qui va in campagna da solo: atterra in "Creative"
// come bozza e aspetta la review di Andrea (regola 5 della costituzione).
const LOCAL_AGENT_ONLINE_MS = 120_000;
const OWNER_USER_ID = 1;

const DEFAULT_ANGLES = [
  "problema→soluzione",
  "prima/dopo",
  "unboxing",
  "3 motivi per cui",
  "POV cliente",
];
const DEFAULT_ENGINE = "tinker";
const DEFAULT_DAILY_COUNT = 3;
const DEFAULT_ASPECT = "9:16";
const DEFAULT_DURATION = 15;

function checkSecret(req: Request, res: Response): boolean {
  const expected = process.env.CARE_WEBHOOK_SECRET;
  if (!expected) {
    res.status(503).json({ error: "CARE_WEBHOOK_SECRET not configured on the server" });
    return false;
  }
  if (req.headers["x-care-secret"] !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function parseList(raw: unknown, fallback: string[]): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return fallback;
  try {
    const j = JSON.parse(s);
    if (Array.isArray(j)) return j.map(String).filter(Boolean);
  } catch {
    // non e' JSON: si accetta anche la lista separata da virgole o a capo
  }
  const list = s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  return list.length ? list : fallback;
}

export function registerVideoRoutes(app: Express) {
  // Agente -> l'interruttore e la configurazione della notte
  app.get("/api/video/config", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const s = await getAllUserSettings(OWNER_USER_ID);
      const lastSeen = Number(s.video_agent_last_seen ?? 0);
      res.json({
        success: true,
        // L'INTERRUTTORE. Se e' false l'agente si ferma subito, senza consumare
        // crediti del motore video.
        autopilot: s.video_autopilot === "true",
        engine: s.video_engine || DEFAULT_ENGINE,
        platform: s.video_platform || "tiktok",
        dailyCount: Math.max(1, Math.min(10, Number(s.video_daily_count ?? DEFAULT_DAILY_COUNT) || DEFAULT_DAILY_COUNT)),
        aspect: s.video_aspect || DEFAULT_ASPECT,
        durationSec: Math.max(5, Math.min(60, Number(s.video_duration_sec ?? DEFAULT_DURATION) || DEFAULT_DURATION)),
        angles: parseList(s.video_angles, DEFAULT_ANGLES),
        products: parseList(s.video_products, []),
        referenceUrls: parseList(s.video_reference_urls, []),
        brandNotes: s.video_brand_notes || "",
        systemPrompt: s.video_system_prompt || "",
        agentOnline: lastSeen > 0 && Date.now() - lastSeen < LOCAL_AGENT_ONLINE_MS,
      });
    } catch (err) {
      console.warn("[video/config] error:", err);
      res.status(500).json({ error: "config failed" });
    }
  });

  // Agente -> materia prima della notte + memoria di cosa ha gia' fatto.
  //
  // "usedHooks" e' la parte che conta: senza, la notte 12 rifa' l'hook della
  // notte 3 e le creative si assomigliano tutte. Stesso problema che il Product
  // Artist ha con history.json, risolto allo stesso modo.
  app.get("/api/video/brief", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const s = await getAllUserSettings(OWNER_USER_ID);
      const drafts = await getVideoDraftsForUser(OWNER_USER_ID);
      const usedHooks = drafts
        .slice(0, 60)
        .map((d) => (d.hook ?? "").trim())
        .filter(Boolean);
      const usedAngles = drafts.slice(0, 30).map((d) => d.angle).filter(Boolean);
      res.json({
        success: true,
        angles: parseList(s.video_angles, DEFAULT_ANGLES),
        products: parseList(s.video_products, []),
        referenceUrls: parseList(s.video_reference_urls, []),
        brandNotes: s.video_brand_notes || "",
        usedHooks,
        usedAngles,
        // Quante bozze aspettano ancora la review: se si accumulano, l'agente
        // rallenta invece di seppellire Andrea di roba da guardare.
        pendingReview: drafts.filter((d) => d.status === "draft").length,
      });
    } catch (err) {
      console.warn("[video/brief] error:", err);
      res.status(500).json({ error: "brief failed" });
    }
  });

  // Agente -> consegna un creative. Atterra in "Creative" come bozza.
  app.post("/api/video/draft", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const videoUrl = b.videoUrl ? String(b.videoUrl) : "";
      if (!videoUrl) {
        // Un record senza video non e' un creative, e' rumore nella pagina.
        res.status(400).json({ error: "videoUrl is required" });
        return;
      }
      const draftId = await insertVideoDraft({
        userId: OWNER_USER_ID,
        platform: b.platform ? String(b.platform) : "tiktok",
        format: b.format ? String(b.format) : "ugc",
        angle: b.angle ? String(b.angle) : null,
        title: b.title ? String(b.title).slice(0, 255) : null,
        hook: b.hook ? String(b.hook) : null,
        script: b.script ? String(b.script) : null,
        caption: b.caption ? String(b.caption) : null,
        hashtags: b.hashtags ? String(b.hashtags) : null,
        videoUrl,
        thumbUrl: b.thumbUrl ? String(b.thumbUrl) : null,
        durationSec: b.durationSec != null ? Number(b.durationSec) : null,
        aspect: b.aspect ? String(b.aspect) : DEFAULT_ASPECT,
        engine: b.engine ? String(b.engine) : DEFAULT_ENGINE,
        productHandle: b.productHandle ? String(b.productHandle).slice(0, 255) : null,
        referenceUrl: b.referenceUrl ? String(b.referenceUrl) : null,
        viralityScore: b.viralityScore != null ? Number(b.viralityScore) : null,
        shotlist: b.shotlist ?? null,
        critique: b.critique ? String(b.critique) : null,
        notes: b.notes ? String(b.notes) : null,
        createdBy: "ai",
        status: "draft",
      });
      res.json({ success: true, draftId });
    } catch (err) {
      console.warn("[video/draft] error:", err);
      res.status(500).json({ error: "draft failed" });
    }
  });

  // Agente -> battito, cosi' la pagina distingue "spento" da "rotto"
  app.post("/api/video/heartbeat", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      await upsertUserSetting(OWNER_USER_ID, "video_agent_last_seen", String(Date.now()));
      res.json({ success: true });
    } catch (err) {
      console.warn("[video/heartbeat] error:", err);
      res.status(500).json({ error: "heartbeat failed" });
    }
  });

  // Agente / script -> scrivere una video_* setting senza passare dalla UI
  app.post("/api/video/setting", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { key, value } = (req.body ?? {}) as { key?: string; value?: unknown };
      if (!key || !/^video_[a-z0-9_]+$/i.test(key)) {
        res.status(400).json({ error: "valid video_* key required" });
        return;
      }
      await upsertUserSetting(OWNER_USER_ID, key, String(value));
      res.json({ success: true, key, value: String(value) });
    } catch (err) {
      console.warn("[video/setting] error:", err);
      res.status(500).json({ error: "setting failed" });
    }
  });
}
