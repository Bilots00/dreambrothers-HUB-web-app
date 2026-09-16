import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { whoIs, isIdentity, rows } from "./focuslockRoutes";

/* FocusLock — il canale per l'agente di produttività (Jordan).
 *
 * PERCHÉ SERVE UNA ROTTA NUOVA. Tutte le rotte /api/focuslock/* esistenti si autenticano con
 * l'ID token Google dell'utente: è l'app che parla, e parla per sé. Un agente che gira 24 ore
 * su 24 su un VPS quel token non ce l'ha e non deve averlo — un token utente in mano a un
 * processo che nessuno guarda è una cattiva idea anche quando il processo è nostro.
 *
 * COME SI AUTENTICA. Con lo stesso segreto condiviso già in produzione per tutto il traffico
 * server-a-server di questa applicazione (x-care-secret / CARE_WEBHOOK_SECRET), esattamente
 * come /api/focuslock/feedback lato owner. Nessuna infrastruttura nuova.
 *
 * LA DIREZIONE. Come per il mastermind e per l'agente Claude, è il VPS a fare polling: questo
 * server non chiama mai il VPS. Jordan legge lo stato quando vuole e deposita il suo verdetto.
 *
 * ── LA PARTE CHE NON È NEGOZIABILE ──────────────────────────────────────────────────────
 * Il segreto condiviso è una chiave di amministrazione dell'intero server. Una rotta che, con
 * quella chiave, restituisse il comportamento quotidiano di UN UTENTE QUALSIASI non sarebbe un
 * canale per un agente personale: sarebbe un rubinetto sui dati di tutti, e basterebbe che quel
 * segreto finisse in un log per trasformarla in una fuga. Per questo le rotte qui sotto
 * lavorano SOLO sugli account elencati esplicitamente in FOCUSLOCK_AGENT_EMAILS. Senza quella
 * variabile non rispondono affatto — e questo è il comportamento voluto, non un caso non
 * gestito: un canale che si apre da solo è un canale che nessuno ha deciso di aprire.
 *
 * E si leggono solo le righe di SISTEMA (prefisso "fl:"), mai i backup: dentro a un backup ci
 * sono regole, password dei blocchi e personalizzazioni, cioè tutto quello che un agente non ha
 * nessun motivo di vedere per dire «ieri hai mollato la sessione delle 21:35».
 * ─────────────────────────────────────────────────────────────────────────────────────── */

/** Le righe di sistema che l'agente può leggere. Tutto il resto è roba dell'utente. */
const LEGGIBILI = ["fl:pc-usage", "fl:agent-in", "fl:jordan"] as const;

/** La riga dove Jordan deposita quello che ha capito. La legge l'app, con il token dell'utente. */
const SLOT_VERDETTO = "fl:jordan";

const MAX_VERDETTO_BYTES = 64 * 1024;

function checkSecret(req: Request, res: Response): boolean {
  const expected = process.env.CARE_WEBHOOK_SECRET;
  if (!expected) { res.status(503).json({ error: "CARE_WEBHOOK_SECRET not configured" }); return false; }
  if (req.headers["x-care-secret"] !== expected) { res.status(401).json({ error: "Unauthorized" }); return false; }
  return true;
}

/** Gli account per cui l'agente è stato autorizzato, in minuscolo. Vuoto = canale chiuso. */
function ammessi(): string[] {
  return String(process.env.FOCUSLOCK_AGENT_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function emailAmmessa(req: Request, res: Response): string | null {
  const lista = ammessi();
  if (!lista.length) {
    res.status(503).json({ error: "FOCUSLOCK_AGENT_EMAILS not configured" });
    return null;
  }
  const email = String((req.query.email ?? (req.body ?? {}).email) || "").trim().toLowerCase();
  if (!email) { res.status(400).json({ error: "email is required" }); return null; }
  if (!lista.includes(email)) { res.status(403).json({ error: "account not enabled for the agent" }); return null; }
  return email;
}

function parse(payload: unknown): unknown {
  if (typeof payload !== "string") return payload ?? null;
  try { return JSON.parse(payload); } catch { return null; }
}

export function registerFocusLockAgentRoutes(app: Express) {
  /* «IO CE L'HO, L'AGENTE?»
   *
   * La chiede l'app con il token dell'utente — non con il segreto — e la risposta e' un
   * booleano e basta: nessun elenco di email esce di qui, nemmeno al diretto interessato.
   *
   * Serve perche' l'app non deve NOMINARE Jordan a chi non ce l'ha. Un riquadro che dice «il
   * tuo agente non ha ancora parlato» a qualcuno che non avra' mai un agente non e' un'attesa:
   * e' una bugia con l'aria di una funzione in arrivo. E l'elenco non puo' stare dentro
   * all'APK, perche' un APK si apre e si legge, e per cambiarlo servirebbe ripubblicare. */
  app.get("/api/focuslock/agent/enabled", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    const lista = ammessi();
    const mia = String(who.email || "").trim().toLowerCase();
    res.json({ enabled: !!mia && lista.includes(mia) });
  });

  /* Quello che l'agente può guardare: le righe di sistema di quell'account, niente altro.
   * Una sola richiesta, così il polling costa un viaggio. */
  app.get("/api/focuslock/agent/state", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    const email = emailAmmessa(req, res);
    if (!email) return;
    try {
      const [slotPc, slotIn, slotOut] = LEGGIBILI;
      const list = await rows(sql`SELECT deviceId, deviceName, programs, apps, payload, updatedAt
        FROM focuslock_backups
        WHERE LOWER(email) = ${email} AND deviceId IN (${slotPc}, ${slotIn}, ${slotOut})`);
      const out: Record<string, unknown> = {};
      for (const r of list) {
        out[String(r.deviceId)] = {
          deviceName: r.deviceName ?? null,
          summary: { programs: Number(r.programs || 0), apps: Number(r.apps || 0) },
          updatedAt: r.updatedAt ?? null,
          payload: parse(r.payload),
        };
      }
      res.json({ email, slots: out });
    } catch (e: any) {
      res.status(500).json({ error: "db: " + (e?.message || String(e)) });
    }
  });

  /* Quello che l'agente ha capito. Va in una riga sua: non tocca nessun backup, non cambia
   * nessuna regola, non blocca niente. È un'opinione depositata, e chi la legge è l'app —
   * che decide lei se mostrarla e come. Un agente che potesse cambiare le regole di blocco
   * dell'utente sarebbe una cosa diversa, e non è questa. */
  app.post("/api/focuslock/agent/verdict", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    const email = emailAmmessa(req, res);
    if (!email) return;

    const body = req.body ?? {};
    const verdetto = body.verdict;
    if (!verdetto || typeof verdetto !== "object") { res.status(400).json({ error: "verdict object is required" }); return; }
    const payload = JSON.stringify({ kind: "focuslock-jordan", v: 1, at: Date.now(), ...verdetto });
    if (payload.length > MAX_VERDETTO_BYTES) { res.status(413).json({ error: "verdict too large" }); return; }

    try {
      /* L'account si identifica dalla riga che l'utente ha già: il googleSub non lo conosce
       * l'agente, e non deve conoscerlo. Se quell'account non ha mai salvato niente, non c'è
       * nessuno a cui consegnare — e dirlo è meglio che creare una riga orfana. */
      const chi = await rows(sql`SELECT googleSub FROM focuslock_backups
        WHERE LOWER(email) = ${email} ORDER BY updatedAt DESC LIMIT 1`);
      const sub = chi.length ? String(chi[0].googleSub) : "";
      if (!sub) { res.status(404).json({ error: "no account with that email" }); return; }

      await rows(sql`INSERT INTO focuslock_backups
          (googleSub, email, deviceId, deviceName, appVersion, programs, apps, sites, keywords, payload, createdAt, updatedAt)
        VALUES (${sub}, ${email}, ${SLOT_VERDETTO}, ${"Jordan"}, ${null}, 0, 0, 0, 0, ${payload}, NOW(), NOW())
        ON DUPLICATE KEY UPDATE payload = VALUES(payload), updatedAt = NOW()`);
      res.json({ saved: true });
    } catch (e: any) {
      res.status(500).json({ error: "db: " + (e?.message || String(e)) });
    }
  });
}
