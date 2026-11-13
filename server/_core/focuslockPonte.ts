import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { rows } from "./focuslockSocial";

/* DreamMap: IL PONTE CON LE ALTRE AI (app 0.9.333).
 *
 * Andrea: "qualsiasi AI agentica l'utente usi, tutto quello su cui lavora deve arrivare al Genio, cosi' la sera sa
 * davvero se ha lavorato sul sogno". Si accende solo se l'utente lo chiede dall'app, e da li' ha una chiave sua:
 * con quella la sua AI scrive un riassunto di cosa ha fatto (mai la conversazione intera), e l'app lo rilegge.
 * Spegnendolo la chiave e tutto quello che era stato scritto spariscono.
 *
 * Due porte per la stessa cosa:
 *  - POST /api/focuslock/ponte/registra: per chi sa fare una chiamata HTTP;
 *  - POST /api/focuslock/ponte/mcp/:chiave: un server MCP (trasporto HTTP) con due strumenti, per Claude Code, Cursor e simili. */

const MAX_TESTO = 2000;
const MAX_GIORNO = 300;
const TIENI_GIORNI = 60;

let pronto: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!pronto) {
    pronto = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_ponte_chiavi (
        chiave VARCHAR(64) PRIMARY KEY,
        device VARCHAR(64) NOT NULL,
        piano TEXT NULL,
        createdAt TIMESTAMP NULL,
        UNIQUE KEY uniq_device (device)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_ponte_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        chiave VARCHAR(64) NOT NULL,
        fonte VARCHAR(40) NOT NULL,
        testo VARCHAR(2000) NOT NULL,
        minuti INT NOT NULL DEFAULT 0,
        inRotta TINYINT NULL,
        createdAt TIMESTAMP NULL,
        INDEX idx_chiave (chiave, createdAt)
      )`);
      /* app 0.9.347: la roadmap scritta dall'AI dell'utente (gratis per noi: la paga lui con il suo abbonamento) */
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_ponte_roadmap (
        chiave VARCHAR(64) PRIMARY KEY,
        piano TEXT NOT NULL,
        createdAt TIMESTAMP NULL
      )`);
    })().catch((e) => { pronto = null; throw e; });
  }
  return pronto;
}

async function esiste(chiave: string): Promise<boolean> {
  if (!/^[a-f0-9]{48}$/.test(chiave)) return false;
  const r = await rows(sql`SELECT chiave FROM focuslock_ponte_chiavi WHERE chiave = ${chiave} LIMIT 1`);
  return r.length > 0;
}

async function scrivi(chiave: string, a: { fonte?: unknown; riassunto?: unknown; minuti?: unknown; in_rotta?: unknown }): Promise<string> {
  const testo = String(a.riassunto ?? "").trim().slice(0, MAX_TESTO);
  if (!testo) throw new Error("riassunto mancante");
  const fonte = String(a.fonte ?? "AI").trim().slice(0, 40) || "AI";
  const minuti = Math.max(0, Math.min(1440, Math.round(Number(a.minuti) || 0)));
  const inRotta = a.in_rotta === true ? 1 : a.in_rotta === false ? 0 : null;
  const quanti = await rows(sql`SELECT COUNT(*) AS n FROM focuslock_ponte_log WHERE chiave = ${chiave} AND createdAt > (NOW() - INTERVAL 1 DAY)`);
  if (Number(quanti[0]?.n || 0) >= MAX_GIORNO) throw new Error("troppe voci oggi");
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  await db.execute(sql`INSERT INTO focuslock_ponte_log (chiave, fonte, testo, minuti, inRotta, createdAt) VALUES (${chiave}, ${fonte}, ${testo}, ${minuti}, ${inRotta}, NOW())`);
  await db.execute(sql`DELETE FROM focuslock_ponte_log WHERE chiave = ${chiave} AND createdAt < (NOW() - INTERVAL ${TIENI_GIORNI} DAY)`);
  return "Registrato: il Genio lo legge nella prossima revisione.";
}

/* app 0.9.347, Andrea: "chi ha gia' un agente suo puo' collegarlo e farsi creare la roadmap da li'". La roadmap arriva nello stesso
 * formato di quella dell'agente di DreamMap ({cinque, anno, mese, settimana, oggi}: testo e passi) e l'app la applica solo con il si'. */
function pulisciPiano(p: any): any {
  if (!p || typeof p !== "object") return null;
  const out: any = {};
  for (const k of ["cinque", "anno", "mese", "settimana", "oggi"]) {
    const x = p[k];
    if (!x || typeof x !== "object") continue;
    const testo = String(x.testo ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    const passi = (Array.isArray(x.passi) ? x.passi : []).map((t: any) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 180)).filter(Boolean).slice(0, 6);
    if (testo || passi.length) out[k] = { testo, passi };
  }
  return out.settimana || out.oggi || out.mese ? out : null;
}
async function scriviRoadmap(chiave: string, a: any): Promise<string> {
  const piano = pulisciPiano(a?.piano ?? a);
  if (!piano) throw new Error("La roadmap deve avere almeno il mese, la settimana o oggi, ognuno con testo e passi.");
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const j = JSON.stringify(piano);
  await db.execute(sql`INSERT INTO focuslock_ponte_roadmap (chiave, piano, createdAt) VALUES (${chiave}, ${j}, NOW()) ON DUPLICATE KEY UPDATE piano = ${j}, createdAt = NOW()`);
  return "Roadmap inviata a DreamMap: l'utente la vede nell'app e la applica con un tocco.";
}
const PASSI_DESCR = "Da 2 a 5 passi concreti. Ogni passo è una frase intera con il verbo all'inizio, produce qualcosa e dura almeno 25 minuti (mai una scelta da due secondi come 'scegliere lo strumento').";
const ANELLO = { type: "object", properties: { testo: { type: "string", description: "Una frase: il traguardo di questo periodo." }, passi: { type: "array", items: { type: "string" }, description: PASSI_DESCR } }, required: ["testo", "passi"] };
const STRUMENTI = [
  {
    name: "registra_lavoro",
    description: "Scrive su DreamMap un riassunto di cosa ha fatto l'utente in questa conversazione. Chiamalo alla fine di ogni lavoro: serve al Genio per sapere su cosa ha lavorato oggi. Solo un riassunto, mai la conversazione intera, mai dati sensibili.",
    inputSchema: {
      type: "object",
      properties: {
        riassunto: { type: "string", description: "Una o due frasi: cosa ha fatto l'utente e a che punto e' arrivato." },
        fonte: { type: "string", description: "Il nome di questa AI, per esempio ChatGPT, Claude, Gemini, Cursor." },
        minuti: { type: "number", description: "Quanti minuti ha lavorato l'utente, stimati. 0 se non lo sai." },
        in_rotta: { type: "boolean", description: "true se il lavoro serve al piano dell'utente (quello letto con leggi_piano), false se e' fuori rotta." },
      },
      required: ["riassunto"],
    },
  },
  {
    name: "scrivi_roadmap",
    description: "Scrive su DreamMap la roadmap dell'utente verso il suo sogno, dopo avergli fatto le domande che servono (una alla volta). La catena va dal lontano al vicino: fra cinque anni, quest'anno, questo mese, questa settimana, oggi; metti solo gli anelli che finiscono prima della data del sogno. L'utente la vede nell'app e la applica lui.",
    inputSchema: {
      type: "object",
      properties: { piano: { type: "object", properties: { cinque: ANELLO, anno: ANELLO, mese: ANELLO, settimana: ANELLO, oggi: ANELLO }, description: "Gli anelli della roadmap." } },
      required: ["piano"],
    },
  },
  {
    name: "leggi_piano",
    description: "Legge il piano dell'utente su DreamMap: il sogno, l'anno, il mese, la settimana e la cosa di oggi. Leggilo all'inizio, per capire se quello che chiede e' in rotta.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function rispondiMcp(chiave: string, m: any): Promise<any> {
  const id = m?.id ?? null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const ko = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  switch (m?.method) {
    case "initialize":
      return ok({
        protocolVersion: String(m?.params?.protocolVersion || "2025-03-26"),
        capabilities: { tools: {} },
        serverInfo: { name: "dreammap", version: "1.0.0" },
        instructions: "All'inizio leggi il piano con leggi_piano. Alla fine di ogni lavoro scrivi un riassunto con registra_lavoro: cosa avete fatto, su quale task, e se era la priorità del piano. Se l'utente ti chiede la sua roadmap, fagli le domande una alla volta e poi scrivila con scrivi_roadmap. Se ti chiede il resoconto della sera, riassumi in registra_lavoro tutto quello su cui avete lavorato oggi e, se il piano non torna più con quello che sta facendo, aggiorna la roadmap con scrivi_roadmap.",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: STRUMENTI });
    case "tools/call": {
      const nome = String(m?.params?.name || "");
      const a = m?.params?.arguments || {};
      try {
        if (nome === "registra_lavoro") return ok({ content: [{ type: "text", text: await scrivi(chiave, a) }] });
        if (nome === "scrivi_roadmap") return ok({ content: [{ type: "text", text: await scriviRoadmap(chiave, a) }] });
        if (nome === "leggi_piano") {
          const r = await rows(sql`SELECT piano FROM focuslock_ponte_chiavi WHERE chiave = ${chiave} LIMIT 1`);
          return ok({ content: [{ type: "text", text: String(r[0]?.piano || "Il piano non e' ancora arrivato: chiedi all'utente di aprire DreamMap.") }] });
        }
        return ko(-32602, "strumento sconosciuto");
      } catch (e: any) {
        return ok({ content: [{ type: "text", text: e?.message || "non riuscito" }], isError: true });
      }
    }
    default:
      return ko(-32601, "metodo non disponibile");
  }
}

export function registerFocusLockPonteRoutes(app: Express) {
  /* accendere il ponte: lo chiede l'utente dall'app */
  app.post("/api/focuslock/ponte/collega", async (req: Request, res: Response) => {
    const device = String(req.body?.device || "").slice(0, 64);
    if (!device) { res.status(400).json({ error: "device mancante" }); return; }
    try {
      await ensure();
      const r = await rows(sql`SELECT chiave FROM focuslock_ponte_chiavi WHERE device = ${device} LIMIT 1`);
      if (r[0]?.chiave) { res.json({ chiave: String(r[0].chiave) }); return; }
      const chiave = crypto.randomBytes(24).toString("hex");
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`INSERT INTO focuslock_ponte_chiavi (chiave, device, createdAt) VALUES (${chiave}, ${device}, NOW())`);
      res.json({ chiave });
    } catch (e: any) { res.status(500).json({ error: e?.message || "non disponibile" }); }
  });
  /* spegnerlo: la chiave e tutto quello che era stato scritto spariscono */
  app.post("/api/focuslock/ponte/scollega", async (req: Request, res: Response) => {
    const chiave = String(req.body?.chiave || "");
    try {
      await ensure();
      if (await esiste(chiave)) {
        const db = await getDb();
        if (!db) throw new Error("database unavailable");
        await db.execute(sql`DELETE FROM focuslock_ponte_log WHERE chiave = ${chiave}`);
        await db.execute(sql`DELETE FROM focuslock_ponte_roadmap WHERE chiave = ${chiave}`);
        await db.execute(sql`DELETE FROM focuslock_ponte_chiavi WHERE chiave = ${chiave}`);
      }
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message || "non disponibile" }); }
  });
  /* app 0.9.347: l'app chiede se l'AI dell'utente ha scritto una roadmap */
  app.get("/api/focuslock/ponte/roadmap", async (req: Request, res: Response) => {
    const chiave = String(req.query?.chiave || "");
    try {
      await ensure();
      if (!(await esiste(chiave))) { res.status(404).json({ error: "chiave sconosciuta" }); return; }
      const r = await rows(sql`SELECT piano, createdAt FROM focuslock_ponte_roadmap WHERE chiave = ${chiave} LIMIT 1`);
      if (!r[0]) { res.json({ piano: null }); return; }
      let piano: any = null; try { piano = JSON.parse(String(r[0].piano)); } catch { piano = null; }
      res.json({ piano, at: r[0].createdAt ? new Date(r[0].createdAt as any).getTime() : 0 });
    } catch (e: any) { res.status(500).json({ error: e?.message || "non disponibile" }); }
  });
  /* l'app manda il piano di oggi, cosi' l'AI puo' leggerlo */
  app.post("/api/focuslock/ponte/piano", async (req: Request, res: Response) => {
    const chiave = String(req.body?.chiave || "");
    try {
      await ensure();
      if (!(await esiste(chiave))) { res.status(404).json({ error: "chiave sconosciuta" }); return; }
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`UPDATE focuslock_ponte_chiavi SET piano = ${String(req.body?.piano || "").slice(0, 4000)} WHERE chiave = ${chiave}`);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message || "non disponibile" }); }
  });
  /* l'app rilegge quello che le AI hanno scritto */
  app.get("/api/focuslock/ponte/log", async (req: Request, res: Response) => {
    const chiave = String(req.query.chiave || "");
    const giorni = Math.max(1, Math.min(TIENI_GIORNI, Number(req.query.giorni) || 30));
    try {
      await ensure();
      if (!(await esiste(chiave))) { res.status(404).json({ error: "chiave sconosciuta" }); return; }
      const r = await rows(sql`SELECT id, fonte, testo, minuti, inRotta, UNIX_TIMESTAMP(createdAt) * 1000 AS at FROM focuslock_ponte_log WHERE chiave = ${chiave} AND createdAt > (NOW() - INTERVAL ${giorni} DAY) ORDER BY id DESC LIMIT 400`);
      res.json({ voci: r.map((x: any) => ({ id: Number(x.id), fonte: String(x.fonte), testo: String(x.testo), minuti: Number(x.minuti) || 0, inRotta: x.inRotta === null ? null : Number(x.inRotta) === 1, at: Number(x.at) })) });
    } catch (e: any) { res.status(500).json({ error: e?.message || "non disponibile" }); }
  });
  /* la porta per chi sa fare una chiamata HTTP */
  app.post("/api/focuslock/ponte/registra", async (req: Request, res: Response) => {
    const chiave = String(req.body?.chiave || req.query.chiave || "");
    try {
      await ensure();
      if (!(await esiste(chiave))) { res.status(404).json({ error: "chiave sconosciuta" }); return; }
      res.json({ ok: true, messaggio: await scrivi(chiave, req.body || {}) });
    } catch (e: any) { res.status(400).json({ error: e?.message || "non riuscito" }); }
  });
  /* la porta MCP */
  app.post("/api/focuslock/ponte/mcp/:chiave", async (req: Request, res: Response) => {
    const chiave = String(req.params.chiave || "");
    try {
      await ensure();
      if (!(await esiste(chiave))) { res.status(404).json({ jsonrpc: "2.0", id: req.body?.id ?? null, error: { code: -32001, message: "chiave sconosciuta" } }); return; }
      const b = req.body;
      if (Array.isArray(b)) {
        const out = [];
        for (const m of b) if (m && m.id !== undefined) out.push(await rispondiMcp(chiave, m));
        if (!out.length) { res.status(202).end(); return; }
        res.json(out);
        return;
      }
      /* una notifica non ha risposta */
      if (!b || b.id === undefined) { res.status(202).end(); return; }
      res.json(await rispondiMcp(chiave, b));
    } catch (e: any) { res.status(500).json({ jsonrpc: "2.0", id: req.body?.id ?? null, error: { code: -32603, message: e?.message || "errore" } }); }
  });
  app.get("/api/focuslock/ponte/mcp/:chiave", (_req: Request, res: Response) => { res.status(405).json({ error: "usa POST" }); });
}
