import type { Express, Request, Response } from "express";
import {
  getDreamTeamOutbox,
  claimDreamTeamMessage,
  markDreamTeamDelivered,
  insertDreamTeamMessageIfNew,
  markDreamTeamHandled,
  upsertDreamTeamAgentRow,
  touchDreamTeamAgent,
  getAllUserSettings,
  upsertUserSetting,
  dreamTeamDbOk,
} from "../db";

// Dream Team endpoints — il lato server del ponte col gruppo Telegram.
// Il motore del mastermind vive sul VPS (dreamteam.py): qui c'e' solo la
// casella di posta. E' il VPS che fa polling (come /api/claude/pending),
// la web app non chiama mai il VPS: nessuna porta nuova, nessun webhook.
//
// Contratto anti-bugia imparato dalla review: con il DB giu' si risponde 503,
// MAI un 200 ottimista — un claim "riuscito" senza DB farebbe postare il ponte
// senza presa in carico, e un outbox "vuoto" nasconderebbe il guasto.
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

export function registerDreamteamRoutes(app: Express) {
  // VPS → la coda in uscita verso Telegram. Non consuma nulla: il consumo
  // passa da /claim. Include da sola le righe col lease scaduto (>2 min).
  app.get("/api/dreamteam/outbox", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
      const rows = await getDreamTeamOutbox(OWNER_USER_ID, limit);
      if (rows === null) { res.status(503).json({ error: "db unavailable" }); return; }
      res.json({
        success: true,
        count: rows.length,
        messages: rows.map((m) => ({
          id: m.id, externalId: m.externalId, role: m.role,
          agentCode: m.agentCode, text: m.text, source: m.source,
          createdAt: m.createdAt,
        })),
      });
    } catch (e) {
      console.warn("[dreamteam/outbox] error:", e);
      res.status(500).json({ error: "outbox failed" });
    }
  });

  // VPS → presa in carico (lease, NON consegna). claimed:false = qualcun altro
  // l'ha gia' presa, o il DB e' giu': in entrambi i casi NON si posta.
  app.post("/api/dreamteam/claim", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const id = Number(req.body?.id);
      if (!id) { res.status(400).json({ error: "id is required" }); return; }
      if (!(await dreamTeamDbOk())) { res.status(503).json({ error: "db unavailable" }); return; }
      const claimed = await claimDreamTeamMessage(id);
      res.json({ success: true, claimed });
    } catch (e) {
      console.warn("[dreamteam/claim] error:", e);
      res.status(500).json({ error: "claim failed" });
    }
  });

  // VPS → esito della consegna. "ok" conferma (deliveredAt + id Telegram),
  // "errore" libera il lease e conta il tentativo (al 5o la riga si chiude
  // da sola con una nota visibile nella stanza).
  app.post("/api/dreamteam/consegnato", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const id = Number(req.body?.id);
      const esito = req.body?.esito === "errore" ? "errore" : "ok";
      if (!id) { res.status(400).json({ error: "id is required" }); return; }
      const ok = await markDreamTeamDelivered(id, esito, Number(req.body?.telegramMessageId) || undefined);
      if (!ok) { res.status(503).json({ error: "db unavailable" }); return; }
      res.json({ success: true });
    } catch (e) {
      console.warn("[dreamteam/consegnato] error:", e);
      res.status(500).json({ error: "consegnato failed" });
    }
  });

  // VPS → specchia nella stanza un messaggio nato su Telegram.
  // Idempotente su (userId, externalId): il duplicate:true di ritorno e' il
  // segnale che il giro NON va riaperto (Telegram riconsegna dopo i crash).
  app.post("/api/dreamteam/ingest", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { externalId, text } = req.body ?? {};
      if (!externalId || !text) { res.status(400).json({ error: "externalId and text are required" }); return; }
      const role = req.body.role === "agent" || req.body.role === "system" ? req.body.role : "user";
      const source = req.body.source === "web" ? "web" : "telegram";
      const esito = await insertDreamTeamMessageIfNew({
        userId: OWNER_USER_ID,
        role,
        agentCode: req.body.agentCode ?? null,
        text: String(text),
        source,
        externalId: String(externalId),
        status: role === "user" ? "new" : "handled",
        replyToId: Number(req.body.replyToId) || null,
        telegramMessageId: Number(req.body.telegramMessageId) || null,
        // Nato su Telegram = gia' consegnato per definizione: mai in outbox.
        deliveredAt: source === "web" ? null : new Date(),
      });
      if (!esito) { res.status(503).json({ error: "db unavailable" }); return; }
      res.json({ success: true, id: esito.id, duplicate: esito.duplicate });
    } catch (e) {
      console.warn("[dreamteam/ingest] error:", e);
      res.status(500).json({ error: "ingest failed" });
    }
  });

  // VPS → la risposta di un agente (in qualunque giro, nato sul web o su Telegram).
  app.post("/api/dreamteam/reply", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { externalId, agentCode, text } = req.body ?? {};
      if (!externalId || !agentCode || !text) {
        res.status(400).json({ error: "externalId, agentCode and text are required" });
        return;
      }
      const esito = await insertDreamTeamMessageIfNew({
        userId: OWNER_USER_ID,
        role: "agent",
        agentCode: String(agentCode),
        text: String(text),
        source: "telegram",
        externalId: String(externalId),
        status: "handled",
        replyToId: Number(req.body.replyToId) || null,
        telegramMessageId: Number(req.body.telegramMessageId) || null,
        deliveredAt: new Date(),
      });
      if (!esito) { res.status(503).json({ error: "db unavailable" }); return; }
      await touchDreamTeamAgent(OWNER_USER_ID, String(agentCode));
      res.json({ success: true, id: esito.id, duplicate: esito.duplicate });
    } catch (e) {
      console.warn("[dreamteam/reply] error:", e);
      res.status(500).json({ error: "reply failed" });
    }
  });

  // VPS → chiude il giro su una domanda. La nota e' l'onesta' del sistema:
  // se degli agenti sono inciampati lo dice, invece di fingere che nessuno
  // avesse nulla da aggiungere.
  app.post("/api/dreamteam/handled", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const id = Number(req.body?.id);
      if (!id) { res.status(400).json({ error: "id is required" }); return; }
      const ok = await markDreamTeamHandled(id, req.body?.nota ?? null);
      if (!ok) { res.status(503).json({ error: "db unavailable" }); return; }
      res.json({ success: true });
    } catch (e) {
      console.warn("[dreamteam/handled] error:", e);
      res.status(500).json({ error: "handled failed" });
    }
  });

  // VPS → battito ogni 30s, SEPARATO dalla consegna (un giro lungo non deve
  // far lampeggiare la spia). Porta con se' quel che solo il VPS sa:
  // l'id del gruppo e se un giro e' in corso.
  app.post("/api/dreamteam/heartbeat", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      if (!(await dreamTeamDbOk())) { res.status(503).json({ error: "db unavailable" }); return; }
      await upsertUserSetting(OWNER_USER_ID, "dreamteam_last_seen", String(Date.now()));
      if (req.body?.groupId) {
        await upsertUserSetting(OWNER_USER_ID, "dreamteam_group_id", String(req.body.groupId));
      }
      await upsertUserSetting(OWNER_USER_ID, "dreamteam_occupato", req.body?.occupato ? "1" : "0");
      res.json({ success: true });
    } catch (e) {
      console.warn("[dreamteam/heartbeat] error:", e);
      res.status(500).json({ error: "heartbeat failed" });
    }
  });

  // VPS all'avvio → sincronizza squadra.json nella tabella del roster.
  // La fonte di verita' resta il file sul VPS: qui arriva la copia leggibile.
  app.post("/api/dreamteam/roster", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const membri = Array.isArray(req.body?.membri) ? req.body.membri : [];
      if (!membri.length) { res.status(400).json({ error: "membri is required" }); return; }
      if (!(await dreamTeamDbOk())) { res.status(503).json({ error: "db unavailable" }); return; }
      for (const m of membri) {
        if (!m?.code || !m?.nome) continue;
        await upsertDreamTeamAgentRow({
          userId: OWNER_USER_ID,
          code: String(m.code),
          nome: String(m.nome),
          emoji: String(m.emoji ?? "•"),
          campo: String(m.campo ?? ""),
          telegramUsername: m.telegramUsername ? String(m.telegramUsername) : null,
          capofila: Boolean(m.capofila),
          attivo: Boolean(m.attivo),
        });
      }
      res.json({ success: true, count: membri.length });
    } catch (e) {
      console.warn("[dreamteam/roster] error:", e);
      res.status(500).json({ error: "roster failed" });
    }
  });

  // Diagnostica da terminale (curl con secret): lo stato vero del ponte,
  // dbOk compreso — la UI ha lo stesso dato via tRPC.
  app.get("/api/dreamteam/config", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const settings = await getAllUserSettings(OWNER_USER_ID);
      const lastSeen = Number(settings["dreamteam_last_seen"] ?? 0);
      res.json({
        success: true,
        agentOnline: lastSeen > 0 && Date.now() - lastSeen < 120_000,
        groupId: settings["dreamteam_group_id"] ?? null,
        occupato: settings["dreamteam_occupato"] === "1",
        dbOk: await dreamTeamDbOk(),
      });
    } catch (e) {
      console.warn("[dreamteam/config] error:", e);
      res.status(500).json({ error: "config failed" });
    }
  });
}
