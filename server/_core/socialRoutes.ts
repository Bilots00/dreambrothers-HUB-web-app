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

  // ─── La cascata della notte ─────────────────────────────────────────────────
  //
  // L'agente chiede QUI da dove partire, invece di deciderlo per conto suo: cosi'
  // l'ordine di precedenza sta scritto in un posto solo (socialReferences.ts) e
  // quello che Andrea vede in Bozze e' esattamente quello che succedera'.
  //
  //   1. caricate → le reference caricate a mano oggi   (repo, gia' nel git pull)
  //   2. link     → i post di cui ha incollato l'URL    (repo, gia' nel git pull)
  //   3. cartella → la cartella di reference del PC     (mirror sul disco del VPS)
  //   4. watchlist→ ULTIMO ripiego                      (/api/social/reference-posts)
  app.get("/api/social/piano-notte", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { pianoNotte, listaLinkReference, listaReferenceSocial, chiaviOccupate, manifestCartella } =
        await import("../socialReferences");
      const giorno = typeof req.query.giorno === "string" ? req.query.giorno : undefined;
      const piano = await pianoNotte(OWNER_USER_ID, { giorno });
      const [link, caricate, occupate, manifest] = await Promise.all([
        listaLinkReference(piano.giorno).catch(() => []),
        listaReferenceSocial(piano.giorno).catch(() => []),
        chiaviOccupate().catch(() => new Set<string>()),
        manifestCartella().catch(() => null),
      ]);
      res.json({
        success: true,
        ...piano,
        // Il materiale vero dei primi due livelli: l'agente ce l'ha gia' nella
        // repo dopo il git pull, ma riceverlo qui gli evita di doverla scandire.
        link: link.filter((l) => l.stato === "in-attesa"),
        caricate,
        // Le reference gia' impegnate (in prova o approvate): l'agente le salta
        // quando pesca dalla cartella del PC, cosi' non ripropone le stesse.
        occupate: Array.from(occupate),
        cartellaVps: manifest?.cartellaVps ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[social/piano-notte] error:", msg);
      res.status(500).json({ error: msg });
    }
  });

  // Agente -> "queste reference le ho usate stanotte".
  //
  // Entrano in stato "in-prova": restano occupate finche' Andrea non giudica la
  // bozza che ne e' nata. Approvata → consumate; scartata → tornano libere.
  app.post("/api/social/reference-usate", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { marcaReferenceUsateMolte } = await import("../socialReferences");
      type VoceIn = { chiave?: unknown; origine?: unknown; draftId?: unknown };
      const ORIGINI = ["cartella", "link", "caricate", "watchlist"] as const;
      const voci: VoceIn[] = Array.isArray(req.body?.voci) ? req.body.voci : [];
      const pulite = voci
        .filter((v) => typeof v?.chiave === "string" && String(v.chiave).trim().length > 0)
        .map((v) => ({
          chiave: String(v.chiave),
          origine: ORIGINI.includes(v.origine as (typeof ORIGINI)[number])
            ? (v.origine as (typeof ORIGINI)[number])
            : ("cartella" as const),
          draftId: v.draftId != null ? Number(v.draftId) : undefined,
        }));
      const n = await marcaReferenceUsateMolte(pulite);
      res.json({ success: true, marcate: n });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[social/reference-usate] error:", msg);
      res.status(500).json({ error: msg });
    }
  });

  // Agente -> esito della lettura di un post indicato per link.
  // Un link che fallisce NON sparisce: resta in UI con il motivo, cosi' Andrea
  // vede che quel post non e' stato leggibile invece di crederlo usato.
  app.post("/api/social/link-esito", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { marcaLinkReference } = await import("../socialReferences");
      const { shortcode, stato, tipo, draftId, errore } = req.body ?? {};
      if (!shortcode) {
        res.status(400).json({ error: "shortcode is required" });
        return;
      }
      await marcaLinkReference(String(shortcode), {
        stato: stato === "usato" || stato === "fallito" ? stato : undefined,
        tipo: tipo === "carosello" || tipo === "post" || tipo === "reel" ? tipo : undefined,
        draftId: draftId != null ? Number(draftId) : undefined,
        errore: errore ? String(errore).slice(0, 300) : undefined,
      });
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[social/link-esito] error:", msg);
      res.status(500).json({ error: msg });
    }
  });

  // Mirror sul PC di Andrea -> l'elenco di cosa c'e' nella cartella di reference.
  //
  // I file veri viaggiano da PC a VPS via ssh; qui arriva solo l'indice, perche'
  // la web app gira su Railway e il disco di Andrea non lo vede. Serve a mostrare
  // in Bozze quante reference restano da usare.
  app.post("/api/social/cartella-manifest", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { salvaManifestCartella } = await import("../socialReferences");
      const { cartellaPc, cartellaVps, file } = req.body ?? {};
      if (!Array.isArray(file)) {
        res.status(400).json({ error: "file[] is required" });
        return;
      }
      type FileIn = { nome?: unknown; size?: unknown; gruppo?: unknown };
      const puliti = (file as FileIn[])
        .filter((f) => typeof f?.nome === "string" && String(f.nome).trim().length > 0)
        .map((f) => ({
          nome: String(f.nome),
          size: Number(f.size ?? 0),
          gruppo: f.gruppo ? String(f.gruppo) : null,
        }));
      await salvaManifestCartella({
        aggiornatoIl: new Date().toISOString(),
        cartellaPc: String(cartellaPc ?? DEFAULT_REFERENCE_FOLDER),
        cartellaVps: String(cartellaVps ?? "~/agents/creative-director/reference-pc"),
        file: puliti,
      });
      res.json({ success: true, file: puliti.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[social/cartella-manifest] error:", msg);
      res.status(500).json({ error: msg });
    }
  });


  // ─── Le bozze si comandano anche da Telegram ────────────────────────────────
  //
  // I bottoni sotto la bozza che arriva in chat (Approva / Scarta / modifica)
  // chiamano qui. E' la stessa strada della web app, non una scorciatoia: passa
  // per updateSocialDraft e fa scattare lo stesso verdetto sulla reference, cosi'
  // approvare da Telegram o da Bozze e' esattamente la stessa cosa.
  app.post("/api/social/draft-azione", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { updateSocialDraft } = await import("../db");
      const { esitoBozzaSuReference } = await import("../socialReferences");
      const { draftId, azione, caption, title, hashtags, scheduledAt } = req.body ?? {};
      const id = Number(draftId);
      if (!id) {
        res.status(400).json({ error: "draftId is required" });
        return;
      }

      const patch: Record<string, unknown> = {};
      if (caption !== undefined) patch.caption = String(caption);
      if (title !== undefined) patch.title = String(title);
      if (hashtags !== undefined) patch.hashtags = String(hashtags);

      if (azione === "approva") {
        patch.status = "scheduled";
        patch.scheduledAt = scheduledAt ? new Date(String(scheduledAt)) : new Date();
      } else if (azione === "scarta") {
        patch.status = "rejected";
      } else if (azione && azione !== "modifica") {
        res.status(400).json({ error: `azione sconosciuta: ${azione}` });
        return;
      }

      await updateSocialDraft(id, patch as Parameters<typeof updateSocialDraft>[1]);

      // Il verdetto sulla bozza vale anche per la reference che l'ha generata:
      // approvata = consumata per sempre, scartata = torna libera per un'altra notte.
      if (azione === "approva") await esitoBozzaSuReference(id, "approvata").catch(() => {});
      if (azione === "scarta") await esitoBozzaSuReference(id, "scartata").catch(() => {});

      res.json({ success: true, draftId: id, azione: azione ?? "modifica" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[social/draft-azione] error:", msg);
      res.status(500).json({ error: msg });
    }
  });

  // Una bozza sola, per nome e cognome: serve al bot per rimostrarla dopo una
  // modifica senza doversi ricordare cosa aveva mandato.
  app.get("/api/social/draft/:id", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { getSocialDraftById } = await import("../db");
      const d = await getSocialDraftById(Number(req.params.id));
      if (!d) {
        res.status(404).json({ error: "bozza non trovata" });
        return;
      }
      res.json({ success: true, draft: d });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[social/draft/:id] error:", msg);
      res.status(500).json({ error: msg });
    }
  });

}
