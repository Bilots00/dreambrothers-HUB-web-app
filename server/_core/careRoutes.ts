import type { Express, Request, Response } from "express";
import {
  upsertCsConversation,
  insertCsMessage,
  getPendingCsMessages,
  recordCsReply,
  getAllUserSettings,
  upsertUserSetting,
  conversationHasPending,
  getCsConversationsForUser,
  deleteCsConversation,
} from "../db";
import { classifica, estraiDalModuloShopify, testoNotifica } from "../careClienti";
import { avvisaSuTelegram } from "../shopifyChargebacks";

// The local Claude agent is considered "online" if it pinged the heartbeat within this window.
const LOCAL_AGENT_ONLINE_MS = 120_000;

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
      const canale = typeof channel === "string" && channel ? channel : "whatsapp";

      // Le mail del modulo contatti arrivano DA mailer@shopify.com: senza questa
      // riattribuzione ogni cliente che scrive dal sito finisce nella stessa
      // conversazione intestata "Shopify", indistinguibile dalle notifiche di
      // sistema. E' il motivo per cui il reso di Naomi (#1263) sarebbe stato
      // invisibile anche se fosse entrato.
      const modulo = estraiDalModuloShopify(String(text));
      const nome = modulo?.nome ?? customerName ?? null;
      const handle = modulo ? modulo.email : String(customerHandle);
      const corpo = modulo
        ? `${modulo.categoria ? `[${modulo.categoria}] ` : ""}${modulo.corpo}`
        : String(text);

      const conversationId = await upsertCsConversation({
        userId: OWNER_USER_ID,
        channel: canale,
        customerName: nome,
        customerHandle: handle,
        channelUrl: channelUrl ?? null,
      });
      const messageId = await insertCsMessage({
        conversationId,
        direction: "in",
        sender: "customer",
        text: corpo,
        status: "new",
      });

      // La notifica sta QUI e non dentro n8n di proposito: e' l'unico punto da
      // cui passano tutti i canali, e regge anche quando un workflow muore. Fino
      // al 18/09/2026 questa rotta scriveva a database e basta, quindi i
      // messaggi entravano in silenzio e nessuno li vedeva.
      const verdetto = classifica({ channel: canale, handle, nome, testo: corpo });
      if (verdetto.cliente) {
        // Un guasto di Telegram non deve far fallire l'ingest: il messaggio e'
        // gia' salvato, e perderlo per colpa di una notifica sarebbe peggio.
        avvisaSuTelegram(
          testoNotifica({ channel: canale, handle, nome, testo: corpo, conversationId }),
        ).catch((err) => console.warn("[care/ingest] notifica non partita:", err));
      } else {
        console.log(`[care/ingest] non notificato (${verdetto.motivo}): ${handle}`);
      }

      res.json({ success: true, conversationId, messageId, notificato: verdetto.cliente, motivo: verdetto.motivo });
    } catch (err) {
      console.warn("[care/ingest] error:", err);
      res.status(500).json({ error: "ingest failed" });
    }
  });

  // Map a raw channel name (or a group name) to one of the 4 config groups.
  function channelGroup(raw: unknown): "whatsapp" | "email" | "instagram" | "facebook" | "" {
    const c = String(raw ?? "").toLowerCase();
    if (!c) return "";
    if (c.startsWith("ig") || c.includes("instagram")) return "instagram";
    if (c.startsWith("fb") || c.includes("facebook") || c.includes("messenger")) return "facebook";
    if (c.includes("mail")) return "email";
    if (c.includes("whats") || c.includes("wa")) return "whatsapp";
    return "";
  }

  // n8n / agent -> read runtime config (autopilot + human-delay). Per-channel when
  // ?channel= is passed, otherwise the global default (back-compat). Per-channel keys
  // (cs_autopilot_<group>, cs_delay_seconds_<group>) fall back to the global keys.
  app.get("/api/care/config", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const settings = await getAllUserSettings(OWNER_USER_ID);
      const group = channelGroup(req.query.channel);

      const globalAuto = settings.cs_autopilot === "true";
      const globalDelay = Number(settings.cs_delay_seconds ?? 90) || 90;

      let autopilot = globalAuto;
      let delaySeconds = globalDelay;
      if (group) {
        const a = settings[`cs_autopilot_${group}`];
        const d = settings[`cs_delay_seconds_${group}`];
        if (a != null) autopilot = a === "true";
        if (d != null) delaySeconds = Number(d) || globalDelay;
      }

      const lastSeen = Number(settings.cs_local_agent_last_seen ?? 0);
      const localAgentOnline = lastSeen > 0 && Date.now() - lastSeen < LOCAL_AGENT_ONLINE_MS;

      res.json({ success: true, channel: group || null, autopilot, delaySeconds, localAgentOnline });
    } catch (err) {
      console.warn("[care/config] error:", err);
      res.status(500).json({ error: "config failed" });
    }
  });

  // Local Claude agent -> heartbeat so the server (and the n8n fallback) know the PC is on
  app.post("/api/care/heartbeat", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      await upsertUserSetting(OWNER_USER_ID, "cs_local_agent_last_seen", String(Date.now()));
      res.json({ success: true });
    } catch (err) {
      console.warn("[care/heartbeat] error:", err);
      res.status(500).json({ error: "heartbeat failed" });
    }
  });

  // Admin: list conversations (id/channel/name/handle/status) for cleanup.
  app.get("/api/care/admin/conversations", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const rows = await getCsConversationsForUser(OWNER_USER_ID);
      res.json({ success: true, conversations: rows.map((c) => ({ id: c.id, channel: c.channel, customerName: c.customerName, customerHandle: c.customerHandle, status: c.status })) });
    } catch (err) {
      console.warn("[care/admin/conversations] error:", err);
      res.status(500).json({ error: "list failed" });
    }
  });

  // Admin: delete a conversation and its messages (cleanup of test data).
  app.post("/api/care/admin/delete-conversation", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const conversationId = Number((req.body ?? {}).conversationId);
      if (!conversationId) {
        res.status(400).json({ error: "conversationId required" });
        return;
      }
      await deleteCsConversation(conversationId);
      res.json({ success: true, deleted: conversationId });
    } catch (err) {
      console.warn("[care/admin/delete-conversation] error:", err);
      res.status(500).json({ error: "delete failed" });
    }
  });

  // Set a Customer Care setting (owner-scoped, secret-protected). Used to flip per-channel
  // autopilot (e.g. cs_autopilot_whatsapp=false = draft-only) without the UI.
  app.post("/api/care/setting", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { key, value } = (req.body ?? {}) as { key?: string; value?: unknown };
      if (!key || !/^cs_[a-z0-9_]+$/i.test(key)) {
        res.status(400).json({ error: "valid cs_* key required" });
        return;
      }
      await upsertUserSetting(OWNER_USER_ID, key, String(value));
      res.json({ success: true, key, value: String(value) });
    } catch (err) {
      console.warn("[care/setting] error:", err);
      res.status(500).json({ error: "setting failed" });
    }
  });

  // n8n fallback -> is this conversation still unhandled? (so n8n only runs OpenAI if Claude didn't)
  app.get("/api/care/status", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const conversationId = Number(req.query.conversationId);
      if (!conversationId) {
        res.status(400).json({ error: "conversationId is required" });
        return;
      }
      const pending = await conversationHasPending(conversationId);
      res.json({ success: true, conversationId, pending, handled: !pending });
    } catch (err) {
      console.warn("[care/status] error:", err);
      res.status(500).json({ error: "status failed" });
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
