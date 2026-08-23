import type { Express, Request, Response } from "express";
import {
  getPendingSocialChat,
  recordSocialChatReply,
  insertSocialChatMessage,
  insertSocialDraft,
  getAllUserSettings,
  upsertUserSetting,
} from "../db";
import { ORARIO_NOTTE } from "../routers";

// Social content endpoints — twin of careRoutes.ts, same "local-Claude-primary" model:
//   the web app writes the owner's chat messages (via tRPC), the LOCAL Claude social
//   agent polls /api/social/pending, replies via /api/social/reply, and drops generated
//   content via /api/social/draft (→ Bozze). Secret-protected server-to-server, reusing
//   the same CARE_WEBHOOK_SECRET so the one local agent needs a single secret.
const LOCAL_AGENT_ONLINE_MS = 120_000;
const OWNER_USER_ID = 1;
const DEFAULT_REFERENCE_FOLDER =
  "E:\\IDriveLocal\\ALL FILES -Cloud-Drive_andrea.bilotta00@gmail.com\\E-commerce\\MARKETING - PNL, Copy & Vendita\\Instagram DAILY post (Organic)";

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

export function registerSocialRoutes(app: Express) {
  // Local Social agent -> read owner chat messages still pending
  app.get("/api/social/pending", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
      const pending = await getPendingSocialChat(limit);
      res.json({ success: true, count: pending.length, messages: pending });
    } catch (err) {
      console.warn("[social/pending] error:", err);
      res.status(500).json({ error: "pending failed" });
    }
  });

  // Local Social agent -> post the AI Manager reply back to the chat
  app.post("/api/social/reply", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { text, replyToId, source } = req.body ?? {};
      if (!text) {
        res.status(400).json({ error: "text is required" });
        return;
      }
      const messageId = await recordSocialChatReply({
        userId: OWNER_USER_ID,
        text: String(text),
        replyToId: replyToId != null ? Number(replyToId) : undefined,
        source: source ? String(source) : undefined,
      });
      res.json({ success: true, messageId });
    } catch (err) {
      console.warn("[social/reply] error:", err);
      res.status(500).json({ error: "reply failed" });
    }
  });

  // External surface (Telegram bot db_smm_bot) -> inject a user message into the SAME thread
  app.post("/api/social/ingest", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { text, source } = req.body ?? {};
      if (!text) {
        res.status(400).json({ error: "text is required" });
        return;
      }
      const messageId = await insertSocialChatMessage({
        userId: OWNER_USER_ID,
        role: "user",
        text: String(text),
        status: "new",
        source: source ? String(source) : "telegram",
      });
      res.json({ success: true, messageId });
    } catch (err) {
      console.warn("[social/ingest] error:", err);
      res.status(500).json({ error: "ingest failed" });
    }
  });

  // Local Social agent -> create a generated draft (lands in Bozze; autopost handled by config)
  app.post("/api/social/draft", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { platform, format, title, caption, hashtags, assets, sourceUrl, scheduledAt, notes } = req.body ?? {};
      if (!platform || !format) {
        res.status(400).json({ error: "platform and format are required" });
        return;
      }
      const draftId = await insertSocialDraft({
        userId: OWNER_USER_ID,
        platform: String(platform),
        format: String(format),
        title: title ?? null,
        caption: caption ?? null,
        hashtags: hashtags ?? null,
        assets: assets ?? null,
        sourceUrl: sourceUrl ?? null,
        notes: notes ?? null,
        createdBy: "ai",
        status: "draft",
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      });
      res.json({ success: true, draftId });
    } catch (err) {
      console.warn("[social/draft] error:", err);
      res.status(500).json({ error: "draft failed" });
    }
  });

  // Social Media Manager notturno -> i post veri da cui parte la notte.
  //
  // Non inventa da zero: prende i post che hanno già funzionato dai canali
  // Instagram della Watchlist (o da un solo profilo, se Andrea ne ha indicato
  // uno dal riquadro in Bozze). L'agente ne studia struttura, ritmo e attacco.
  app.get("/api/social/reference-posts", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { postDiRiferimento, getFonteSocial } = await import("../socialReferences");
      const fonte = await getFonteSocial().catch(() => null);
      const handleParam = typeof req.query.handle === "string" ? req.query.handle : undefined;
      // Il parametro esplicito vince; altrimenti si segue la fonte impostata.
      const handle = handleParam || (fonte?.modo === "profilo" ? fonte.handle : undefined);
      const limit = Math.min(Number(req.query.limit) || 12, 30);
      const posts = await postDiRiferimento(OWNER_USER_ID, { handle, limit });
      res.json({ success: true, modo: fonte?.modo ?? "auto", handle: handle ?? null, posts });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[social/reference-posts] error:", msg);
      res.status(500).json({ error: msg });
    }
  });

  // Agent / n8n -> runtime config: autopilot toggle + reference folder + system prompt + agent online
  app.get("/api/social/config", async (_req: Request, res: Response) => {
    if (!checkSecret(_req, res)) return;
    try {
      const s = await getAllUserSettings(OWNER_USER_ID);
      const lastSeen = Number(s.social_local_agent_last_seen ?? 0);
      res.json({
        success: true,
        autopilot: s.social_autopilot === "true",
        referenceFolder: s.social_reference_folder || DEFAULT_REFERENCE_FOLDER,
        systemPrompt: s.social_system_prompt || "",
        localAgentOnline: lastSeen > 0 && Date.now() - lastSeen < LOCAL_AGENT_ONLINE_MS,
        // Le due manopole che il cron del VPS interroga prima di lavorare:
        // se nightlyEnabled e' false non parte, e parte solo all'ora indicata.
        nightlyEnabled: s.social_nightly_enabled !== "false",
        nightlyRunAt: ORARIO_NOTTE(s.social_nightly_run_at),
      });
    } catch (err) {
      console.warn("[social/config] error:", err);
      res.status(500).json({ error: "config failed" });
    }
  });

  // Local Social agent -> heartbeat so the server knows the PC is on
  app.post("/api/social/heartbeat", async (_req: Request, res: Response) => {
    if (!checkSecret(_req, res)) return;
    try {
      await upsertUserSetting(OWNER_USER_ID, "social_local_agent_last_seen", String(Date.now()));
      res.json({ success: true });
    } catch (err) {
      console.warn("[social/heartbeat] error:", err);
      res.status(500).json({ error: "heartbeat failed" });
    }
  });

  // Set a social_* setting (autopilot, reference folder, system prompt) secret-protected
  app.post("/api/social/setting", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { key, value } = (req.body ?? {}) as { key?: string; value?: unknown };
      if (!key || !/^social_[a-z0-9_]+$/i.test(key)) {
        res.status(400).json({ error: "valid social_* key required" });
        return;
      }
      await upsertUserSetting(OWNER_USER_ID, key, String(value));
      res.json({ success: true, key, value: String(value) });
    } catch (err) {
      console.warn("[social/setting] error:", err);
      res.status(500).json({ error: "setting failed" });
    }
  });
}
