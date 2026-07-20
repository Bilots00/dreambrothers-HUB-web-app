import type { Express, Request, Response } from "express";
import {
  createClaudeSession,
  getClaudeSessionById,
  findClaudeSessionByExternalId,
  getClaudeSessions,
  getClaudeSessionMessages,
  insertClaudeMessage,
  getPendingClaudeMessages,
  recordClaudeReply,
  updateClaudeSession,
  getClaudeAttachmentById,
  getAllUserSettings,
  upsertUserSetting,
} from "../db";

// Claude Sessions endpoints — gemello di socialRoutes.ts, stesso modello
// "agente-primario": la web app scrive i messaggi dell'owner (via tRPC), l'agente
// Claude (VPS o locale) fa polling su /api/claude/pending e risponde via
// /api/claude/reply. In più, Claude Code importa/esporta interi transcript via
// /api/claude/session usando externalId come chiave stabile per l'upsert.
// Server-to-server protetto dallo stesso CARE_WEBHOOK_SECRET: un solo segreto.
const CLAUDE_AGENT_ONLINE_MS = 120_000;
const OWNER_USER_ID = 1;

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

// Il titolo di default nasce dal primo messaggio: stessa regola lato tRPC e REST,
// così una sessione creata da mobile e una creata da Claude Code si somigliano.
function titleFromText(text: string): string {
  const flat = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  if (!flat) return "Nuova sessione";
  return flat.length > 60 ? flat.slice(0, 59) + "…" : flat;
}

export function registerClaudeRoutes(app: Express) {
  // Agente Claude -> messaggi dell'owner ancora da gestire (tutte le sessioni)
  app.get("/api/claude/pending", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
      const pending = await getPendingClaudeMessages(limit);
      res.json({ success: true, count: pending.length, messages: pending });
    } catch (err) {
      console.warn("[claude/pending] error:", err);
      res.status(500).json({ error: "pending failed" });
    }
  });

  // Claude Code (session-import) -> i turni di una sessione, per riprendere il filo.
  // ?since=<ISO> filtra i turni successivi all'ultimo export locale.
  app.get("/api/claude/session/:id/messages", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "invalid session id" });
        return;
      }
      const session = await getClaudeSessionById(id);
      if (!session) {
        res.status(404).json({ error: "session not found" });
        return;
      }
      const limit = Math.min(parseInt(String(req.query.limit ?? "500"), 10) || 500, 1000);
      let messages = await getClaudeSessionMessages(id, limit);
      const since = req.query.since ? new Date(String(req.query.since)) : null;
      if (since && !Number.isNaN(since.getTime())) {
        messages = messages.filter((m) => new Date(m.createdAt).getTime() > since.getTime());
      }
      res.json({
        success: true,
        session: { id: session.id, title: session.title, externalId: session.externalId, status: session.status },
        count: messages.length,
        messages,
      });
    } catch (err) {
      console.warn("[claude/session/messages] error:", err);
      res.status(500).json({ error: "messages failed" });
    }
  });

  // Agente / Claude Code -> elenco sessioni, con ricerca ?q=
  app.get("/api/claude/sessions", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const q = req.query.q ? String(req.query.q) : undefined;
      const includeArchived = String(req.query.includeArchived ?? "") === "true";
      const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 200);
      const sessions = await getClaudeSessions(OWNER_USER_ID, { q, includeArchived, limit });
      res.json({ success: true, count: sessions.length, sessions });
    } catch (err) {
      console.warn("[claude/sessions] error:", err);
      res.status(500).json({ error: "sessions failed" });
    }
  });

  // Agente Claude -> pubblica la risposta nella sessione
  app.post("/api/claude/reply", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { sessionId, text, replyToId, source } = req.body ?? {};
      if (!sessionId || !text) {
        res.status(400).json({ error: "sessionId and text are required" });
        return;
      }
      const session = await getClaudeSessionById(Number(sessionId));
      if (!session) {
        res.status(404).json({ error: "session not found" });
        return;
      }
      const messageId = await recordClaudeReply({
        sessionId: Number(sessionId),
        userId: OWNER_USER_ID,
        text: String(text),
        replyToId: replyToId != null ? Number(replyToId) : undefined,
        source: source ? String(source) : undefined,
      });
      res.json({ success: true, messageId, sessionId: Number(sessionId) });
    } catch (err) {
      console.warn("[claude/reply] error:", err);
      res.status(500).json({ error: "reply failed" });
    }
  });

  // Superficie esterna (bot Telegram) -> inietta un messaggio owner in una sessione.
  // Risolve per sessionId o externalId; se manca tutto, apre una sessione nuova.
  // Ritorna SEMPRE sessionId così il chiamante può continuare il thread.
  app.post("/api/claude/ingest", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { text, sessionId, externalId, title, source } = req.body ?? {};
      if (!text) {
        res.status(400).json({ error: "text is required" });
        return;
      }
      const src = source ? String(source) : "telegram";
      let resolvedId: number | null = null;

      if (sessionId != null) {
        const existing = await getClaudeSessionById(Number(sessionId));
        if (!existing) {
          res.status(404).json({ error: "session not found" });
          return;
        }
        resolvedId = existing.id;
      } else if (externalId) {
        const existing = await findClaudeSessionByExternalId(OWNER_USER_ID, String(externalId));
        resolvedId = existing
          ? existing.id
          : await createClaudeSession({
              userId: OWNER_USER_ID,
              title: title ? String(title) : titleFromText(String(text)),
              source: src,
              externalId: String(externalId),
            });
      } else {
        resolvedId = await createClaudeSession({
          userId: OWNER_USER_ID,
          title: title ? String(title) : titleFromText(String(text)),
          source: src,
        });
      }

      const messageId = await insertClaudeMessage({
        sessionId: resolvedId,
        userId: OWNER_USER_ID,
        role: "user",
        text: String(text),
        source: src,
        status: "new",
      });
      res.json({ success: true, messageId, sessionId: resolvedId });
    } catch (err) {
      console.warn("[claude/ingest] error:", err);
      res.status(500).json({ error: "ingest failed" });
    }
  });

  // Claude Code (session-export) -> upsert della sessione per externalId + import
  // bulk del transcript. I messaggi arrivano già "handled": sono storia, non lavoro
  // da fare, quindi l'agente non deve rispondere.
  app.post("/api/claude/session", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { externalId, title, source, messages } = req.body ?? {};
      if (!externalId && !title) {
        res.status(400).json({ error: "externalId or title is required" });
        return;
      }
      const src = source ? String(source) : "code";
      const existing = externalId
        ? await findClaudeSessionByExternalId(OWNER_USER_ID, String(externalId))
        : undefined;

      let sessionId: number;
      if (existing) {
        sessionId = existing.id;
        if (title && title !== existing.title) {
          await updateClaudeSession(sessionId, { title: String(title) });
        }
      } else {
        sessionId = await createClaudeSession({
          userId: OWNER_USER_ID,
          title: title ? String(title) : String(externalId),
          source: src,
          externalId: externalId ? String(externalId) : null,
        });
      }

      let inserted = 0;
      if (Array.isArray(messages)) {
        for (const m of messages) {
          if (!m?.text) continue;
          const role = m.role === "assistant" || m.role === "system" ? m.role : "user";
          const createdAt = m.createdAt ? new Date(m.createdAt) : undefined;
          await insertClaudeMessage({
            sessionId,
            userId: OWNER_USER_ID,
            role,
            text: String(m.text),
            source: m.source ? String(m.source) : src,
            status: "handled",
            ...(createdAt && !Number.isNaN(createdAt.getTime()) ? { createdAt } : {}),
          });
          inserted++;
        }
      }
      res.json({ success: true, sessionId, inserted, created: !existing });
    } catch (err) {
      console.warn("[claude/session] error:", err);
      res.status(500).json({ error: "session upsert failed" });
    }
  });

  // Download di un allegato. L'app e' single-user senza login (vedi context.ts:
  // ogni richiesta e' gia' admin), quindi qui non c'e' un livello di auth in piu'
  // da applicare: stessa postura del resto dell'app. Serve al browser per mostrare
  // immagini/audio e all'agente per scaricare i file che Andrea allega.
  app.get("/api/claude/attachment/:id", async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "invalid attachment id" });
        return;
      }
      const att = await getClaudeAttachmentById(id);
      if (!att) {
        res.status(404).json({ error: "attachment not found" });
        return;
      }
      res.setHeader("Content-Type", att.mimeType);
      res.setHeader("Content-Length", String(att.size));
      // inline: immagini e audio devono potersi aprire dentro la pagina
      const disp = req.query.download === "1" ? "attachment" : "inline";
      res.setHeader("Content-Disposition", `${disp}; filename="${att.filename.replace(/"/g, "")}"`);
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.send(att.data);
    } catch (err) {
      console.warn("[claude/attachment] error:", err);
      res.status(500).json({ error: "attachment failed" });
    }
  });

  // Agente Claude -> heartbeat, così la web app mostra il pallino "online"
  app.post("/api/claude/heartbeat", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      await upsertUserSetting(OWNER_USER_ID, "claude_agent_last_seen", String(Date.now()));
      res.json({ success: true });
    } catch (err) {
      console.warn("[claude/heartbeat] error:", err);
      res.status(500).json({ error: "heartbeat failed" });
    }
  });

  // Agente -> config runtime + stato agente
  app.get("/api/claude/config", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const s = await getAllUserSettings(OWNER_USER_ID);
      const lastSeen = Number(s.claude_agent_last_seen ?? 0);
      res.json({
        success: true,
        ownerUserId: OWNER_USER_ID,
        systemPrompt: s.claude_system_prompt || "",
        agentOnline: lastSeen > 0 && Date.now() - lastSeen < CLAUDE_AGENT_ONLINE_MS,
        agentLastSeen: lastSeen || null,
      });
    } catch (err) {
      console.warn("[claude/config] error:", err);
      res.status(500).json({ error: "config failed" });
    }
  });
}
