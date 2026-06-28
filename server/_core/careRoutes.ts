import type { Express, Request, Response } from "express";
import {
  upsertCsConversation,
  insertCsMessage,
  getPendingCsMessages,
  recordCsReply,
  getAllUserSettings,
} from "../db";

// Customer Care server-to-server endpoints, used by the n8n workflow (the always-on
// "ear" + OpenAI fallback) and by the local Claude CS agent. Protected by a shared
// secret header so they bypass the single-user web session safely.
//
//   POST /api/care/ingest   -> n8n writes every inbound customer message
//   GET  /api/care/pending  -> the Claude agent reads messages still "new" to handle
//   POST /api/care/reply    -> records a reply + marks the conversation handled
//
// The owner is always user id 1 (single-user app).
const OWNER_USER_ID = 1;

function checkSecret(req: Request, res: Response): boolean {
  const expected = process.env.CARE_WEBHOOK_SECRET;
  if (!expected) {
    res.status(503).json({ error: "CARE_WEBHOOK_SECRET not configured on the server" });
    return false;
  }
  const provided = req.headers["x-care-secret"];
  if (provided !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

export function registerCareRoutes(app: Express) {
  // n8n -> ingest an inbound customer message
  app.post("/api/care/ingest", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { channel, customerName, customerHandle, text, channelUrl } = req.body ?? {};
      if (!customerHandle || !text) {
        res.status(400).json({ error: "customerHandle and text are required" });
        return;
      }
      const conversationId = await upsertCsConversation({
        userId: OWNER_USER_ID,
        channel: typeof channel === "string" && channel ? channel : "whatsapp",
        customerName: customerName ?? null,
        customerHandle: String(customerHandle),
        channelUrl: channelUrl ?? null,
      });
      const messageId = await insertCsMessage({
        conversationId,
        direction: "in",
        sender: "customer",
        text: String(text),
        status: "new",
      });
      res.json({ success: true, conversationId, messageId });
    } catch (err) {
      console.warn("[care/ingest] error:", err);
      res.status(500).json({ error: "ingest failed" });
    }
  });

  // n8n / agent -> read runtime config (e.g. whether AI autopilot auto-send is ON)
  app.get("/api/care/config", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const settings = await getAllUserSettings(OWNER_USER_ID);
      res.json({
        success: true,
        autopilot: settings.cs_autopilot === "true",
        delaySeconds: Number(settings.cs_delay_seconds ?? 90) || 90,
      });
    } catch (err) {
      console.warn("[care/config] error:", err);
      res.status(500).json({ error: "config failed" });
    }
  });

  // Claude agent -> read messages still pending (not yet handled)
  app.get("/api/care/pending", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
      const pending = await getPendingCsMessages(limit);
      res.json({ success: true, count: pending.length, messages: pending });
    } catch (err) {
      console.warn("[care/pending] error:", err);
      res.status(500).json({ error: "pending failed" });
    }
  });

  // Claude agent / n8n fallback -> record the reply + mark the conversation handled
  app.post("/api/care/reply", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { conversationId, text, handledBy, needsHuman, reason } = req.body ?? {};
      if (!conversationId) {
        res.status(400).json({ error: "conversationId is required" });
        return;
      }
      const by: "claude" | "openai" | "human" =
        handledBy === "openai" ? "openai" : handledBy === "human" ? "human" : "claude";
      const sender: "ai" | "human" = by === "human" ? "human" : "ai";
      const messageId = await recordCsReply({
        conversationId: Number(conversationId),
        text: text ?? null,
        sender,
        handledBy: by,
        needsHuman: Boolean(needsHuman),
        reason: reason ?? null,
      });
      res.json({ success: true, messageId });
    } catch (err) {
      console.warn("[care/reply] error:", err);
      res.status(500).json({ error: "reply failed" });
    }
  });
}
