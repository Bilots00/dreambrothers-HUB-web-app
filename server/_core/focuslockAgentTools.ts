import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { rows } from "./focuslockSocial";

/* FocusLock / DreamMap — GLI STRUMENTI DELL'AGENTE PERSONALE (0.9.207)
 *
 * L'agente (sul VPS, o qualsiasi client MCP-like) chiama qui per cambiare l'app di UNA persona:
 * aggiornare la sua roadmap, creare un programma di blocco con condizioni precise (anche una
 * parola in tutta la pagina, non solo nell'indirizzo), far partire un blocco rapido. Ogni
 * chiamata diventa un COMANDO in coda; il telefono lo prende al prossimo sync e lo applica.
 *
 * Sicurezza: ogni chiamata porta l'intestazione x-agent-key uguale a AGENT_TOOLS_KEY (una
 * variabile di Railway che decide Andrea). Senza la variabile il servizio risponde 503: meglio
 * spento che aperto. Il device e' quello dell'app: l'agente lo conosce perche' lo ha ricevuto
 * dall'app stessa (la stessa identita' della classifica). */
let ready: Promise<void> | null = null;
function ensureComandi(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_comandi (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device VARCHAR(64) NOT NULL,
        tipo VARCHAR(24) NOT NULL,
        payload TEXT NULL,
        createdAt TIMESTAMP NULL,
        fattoAt TIMESTAMP NULL,
        INDEX (device, fattoAt)
      )`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const TOOLS = [
  { name: "aggiorna_roadmap", description: "Scrive o aggiorna la roadmap su misura della persona: le prossime tappe, in ordine, ognuna con titolo, cosa fare e minuti previsti.",
    input_schema: { type: "object", properties: { device: { type: "string" }, titolo: { type: "string" }, tappe: { type: "array", items: { type: "object", properties: { titolo: { type: "string" }, cosa: { type: "string" }, minuti: { type: "number" }, giorno: { type: "string", description: "AAAA-MM-GG, facoltativo" } }, required: ["titolo"] } } }, required: ["device", "tappe"] } },
  { name: "crea_programma", description: "Crea un programma di blocco con le condizioni chieste dalla persona: app, siti, parole chiave (nell'indirizzo, nel dominio o in tutta la pagina), orario e giorni.",
    input_schema: { type: "object", properties: { device: { type: "string" }, nome: { type: "string" }, app: { type: "array", items: { type: "string" }, description: "package Android" }, siti: { type: "array", items: { type: "string" } }, parole: { type: "array", items: { type: "string" } }, dove: { type: "string", enum: ["url", "dominio", "pagina"], description: "dove cercare le parole" }, dalle: { type: "string", description: "HH:MM" }, alle: { type: "string", description: "HH:MM" }, giorni: { type: "array", items: { type: "boolean" }, description: "7 valori, da lunedi'" }, tuttoIlGiorno: { type: "boolean" } }, required: ["device", "nome"] } },
  { name: "crea_blocco_rapido", description: "Fa partire subito un blocco di N minuti su app, siti o parole chiave.",
    input_schema: { type: "object", properties: { device: { type: "string" }, minuti: { type: "number" }, app: { type: "array", items: { type: "string" } }, siti: { type: "array", items: { type: "string" } }, parole: { type: "array", items: { type: "string" } }, dove: { type: "string", enum: ["url", "dominio", "pagina"] } }, required: ["device", "minuti"] } },
];
const TIPO: Record<string, string> = { aggiorna_roadmap: "roadmap", crea_programma: "programma", crea_blocco_rapido: "blocco_rapido" };

function chiave(req: Request): boolean {
  const k = String(process.env.AGENT_TOOLS_KEY || "");
  if (!k) return false;
  return String(req.header("x-agent-key") || "") === k;
}
const lista = (v: any, n = 50) => (Array.isArray(v) ? v : []).map((x: any) => String(x || "").trim().slice(0, 120)).filter(Boolean).slice(0, n);
const ora = (v: any, d: string) => (/^\d{2}:\d{2}$/.test(String(v || "")) ? String(v) : d);

export async function comandiPendenti(device: string): Promise<{ id: number; tipo: string; payload: string }[]> {
  await ensureComandi();
  const r = await rows(sql`SELECT id, tipo, payload FROM focuslock_comandi WHERE device = ${device} AND fattoAt IS NULL ORDER BY id ASC LIMIT 20`);
  return r.map((x: any) => ({ id: Number(x.id), tipo: String(x.tipo), payload: String(x.payload || "{}") }));
}

export function registerFocusLockAgentTools(app: Express) {
  /* la lista degli strumenti, nel formato dei tool di Claude: un client MCP la legge cosi' com'e' */
  app.get("/api/focuslock/agente/tools", (_req: Request, res: Response) => {
    res.json({ acceso: !!process.env.AGENT_TOOLS_KEY, tools: TOOLS });
  });
  app.post("/api/focuslock/agente/call", async (req: Request, res: Response) => {
    if (!process.env.AGENT_TOOLS_KEY) { res.status(503).json({ error: "strumenti spenti: manca AGENT_TOOLS_KEY" }); return; }
    if (!chiave(req)) { res.status(401).json({ error: "chiave sbagliata" }); return; }
    const b = req.body || {};
    const tool = String(b.tool || "");
    const a = b.args || {};
    const device = String(a.device || b.device || "").slice(0, 64);
    if (!TIPO[tool]) { res.status(400).json({ error: "strumento sconosciuto" }); return; }
    if (!device) { res.status(400).json({ error: "device mancante" }); return; }
    let payload: any = {};
    if (tool === "aggiorna_roadmap") {
      payload = { titolo: String(a.titolo || "").slice(0, 80), tappe: (Array.isArray(a.tappe) ? a.tappe : []).slice(0, 30).map((t: any) => ({ titolo: String(t?.titolo || "").slice(0, 120), cosa: String(t?.cosa || "").slice(0, 400), minuti: Math.max(0, Math.min(480, Number(t?.minuti) || 0)), giorno: /^\d{4}-\d{2}-\d{2}$/.test(String(t?.giorno || "")) ? String(t.giorno) : "" })).filter((t: any) => t.titolo) };
      if (!payload.tappe.length) { res.status(400).json({ error: "nessuna tappa" }); return; }
    } else if (tool === "crea_programma") {
      payload = { nome: String(a.nome || "Dal tuo agente").slice(0, 60), app: lista(a.app), siti: lista(a.siti), parole: lista(a.parole), dove: ["url", "dominio", "pagina"].includes(String(a.dove)) ? String(a.dove) : "url", dalle: ora(a.dalle, "09:00"), alle: ora(a.alle, "18:00"), giorni: Array.isArray(a.giorni) && a.giorni.length === 7 ? a.giorni.map((x: any) => !!x) : [true, true, true, true, true, true, true], tuttoIlGiorno: !!a.tuttoIlGiorno };
    } else {
      payload = { minuti: Math.max(5, Math.min(480, Number(a.minuti) || 25)), app: lista(a.app), siti: lista(a.siti), parole: lista(a.parole), dove: ["url", "dominio", "pagina"].includes(String(a.dove)) ? String(a.dove) : "url" };
    }
    try {
      await ensureComandi();
      await rows(sql`INSERT INTO focuslock_comandi (device, tipo, payload, createdAt) VALUES (${device}, ${TIPO[tool]}, ${JSON.stringify(payload)}, NOW())`);
      const r = await rows(sql`SELECT MAX(id) AS id FROM focuslock_comandi WHERE device = ${device}`);
      res.json({ ok: true, id: Number(r[0]?.id || 0), tipo: TIPO[tool], nota: "In coda: il telefono lo applica al prossimo sync (entro pochi minuti con l'app aperta)." });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "comando non salvato" });
    }
  });
  /* il telefono conferma: i comandi applicati non tornano piu' */
  app.post("/api/focuslock/social/comandi/fatti", async (req: Request, res: Response) => {
    const b = req.body || {};
    const device = String(b.device || "").slice(0, 64);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map((x: any) => Number(x)).filter((x: number) => x > 0).slice(0, 50);
    if (!device || !ids.length) { res.json({ ok: true }); return; }
    try {
      await ensureComandi();
      for (const id of ids) await rows(sql`UPDATE focuslock_comandi SET fattoAt = NOW() WHERE device = ${device} AND id = ${id}`);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message || "non confermato" }); }
  });
}
