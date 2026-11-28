import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { rows } from "./dreammapSocial";
/* app 0.9.390 (BUG-122): una tappa e' un'azione che fa avanzare, mai raccolta di dati */
import { REGOLA_PASSO_AVANZA_BREVE } from "./dreammapRegolaPassi";
import { REGOLA_ROADMAP_BUSINESS_BREVE } from "./dreammapRegolaBusiness";

/* DreamMap — GLI STRUMENTI DELL'AGENTE PERSONALE (0.9.207)
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

/* i momenti che l'app vede da sola (www/js/regole-misura.js, RS_QUANDO) */
const QUANDO = ["caveau", "deviazione", "tieniRighe", "taglia", "passo", "riga", "sessione", "mollata", "ceduto", "giornoSenzaDeviazioni", "giornoSenzaSessioni",
  /* 0.9.290: i momenti nuovi, per regole-flusso come in n8n */
  "umore", "respiro", "tappa", "tempoTelefono", "tempoApp", "giornoSessioni"];
const GIORNI = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
const intero = (v: any, a: number, b: number) => { const n = Math.round(Number(v)); return v === undefined || v === null || v === "" || !isFinite(n) ? undefined : Math.max(a, Math.min(b, n)); };
const TOOLS = [
  { name: "aggiorna_roadmap", description: "Scrive o aggiorna la roadmap su misura della persona: le prossime tappe, in ordine, ognuna con titolo, cosa fare e minuti previsti. Ogni testo in italiano intero, con verbo e oggetto, senza abbreviazioni né barre (no «1 video/giorno feriale», sì «Girare e pubblicare un video al giorno, dal lunedì al venerdì»). " + REGOLA_PASSO_AVANZA_BREVE + " " + REGOLA_ROADMAP_BUSINESS_BREVE,
    input_schema: { type: "object", properties: { device: { type: "string" }, titolo: { type: "string" }, tappe: { type: "array", items: { type: "object", properties: { titolo: { type: "string" }, cosa: { type: "string" }, minuti: { type: "number" }, giorno: { type: "string", description: "AAAA-MM-GG, facoltativo" } }, required: ["titolo"] } } }, required: ["device", "tappe"] } },
  { name: "crea_programma", description: "Crea un programma di blocco con le condizioni chieste dalla persona: app, siti, parole chiave (nell'indirizzo, nel dominio o in tutta la pagina), orario e giorni.",
    input_schema: { type: "object", properties: { device: { type: "string" }, nome: { type: "string" }, app: { type: "array", items: { type: "string" }, description: "package Android" }, siti: { type: "array", items: { type: "string" } }, parole: { type: "array", items: { type: "string" } }, dove: { type: "string", enum: ["url", "dominio", "pagina"], description: "dove cercare le parole" }, dalle: { type: "string", description: "HH:MM" }, alle: { type: "string", description: "HH:MM" }, giorni: { type: "array", items: { type: "boolean" }, description: "7 valori, da lunedi'" }, tuttoIlGiorno: { type: "boolean" } }, required: ["device", "nome"] } },
  { name: "crea_blocco_rapido", description: "Fa partire subito un blocco di N minuti su app, siti o parole chiave.",
    input_schema: { type: "object", properties: { device: { type: "string" }, minuti: { type: "number" }, app: { type: "array", items: { type: "string" } }, siti: { type: "array", items: { type: "string" } }, parole: { type: "array", items: { type: "string" } }, dove: { type: "string", enum: ["url", "dominio", "pagina"] } }, required: ["device", "minuti"] } },
  /* 0.9.285: le regole su misura della partita (il nuovo te contro il vecchio te) e l'imprevisto che sposta l'arrivo */
  { name: "crea_regola_partita", description: "Aggiunge alla partita della persona (il nuovo te contro il vecchio te) una regola su misura per il suo obiettivo, come un piccolo flusso n8n: QUANDO (un momento che l'app vede da sola) + SE (condizioni: orario, giorni, parole, minuti, la volta del giorno, un tetto al giorno) + ALLORA (chi prende i punti e quanti). Una richiesta complicata diventa piu' regole. Una cosa che l'app non vede da sola non diventa una regola.",
    input_schema: { type: "object", properties: { device: { type: "string" }, nome: { type: "string", description: "la regola in poche parole" }, quando: { type: "string", enum: QUANDO }, chi: { type: "string", enum: ["nuovo", "vecchio"] }, punti: { type: "number", description: "da 1 a 3" }, entro: { type: "string", description: "HH:MM, vale solo prima di quest'ora" }, dopo: { type: "string", description: "HH:MM, vale solo da quest'ora" }, parole: { type: "array", items: { type: "string" }, description: "vale solo se il testo contiene una di queste parole" }, giorni: { type: "array", items: { type: "string", enum: GIORNI }, description: "vale solo in questi giorni della settimana" }, piuDi: { type: "number", description: "minuti: vale se la durata o il tempo misurato supera questo valore" }, menoDi: { type: "number", description: "minuti: vale se la durata o il tempo misurato sta sotto questo valore" }, app: { type: "string", description: "per tempoApp: il nome dell'app (per esempio Instagram)" }, dallaVolta: { type: "number", description: "vale dalla N-esima volta del giorno" }, maxGiorno: { type: "number", description: "al massimo N volte al giorno" }, almeno: { type: "number", description: "per giornoSessioni: quante sessioni servono" }, votoMax: { type: "number", description: "per umore: vale con un voto fino a questo (1-5)" }, votoMin: { type: "number", description: "per umore: vale con un voto da questo in su (1-5)" }, perche: { type: "string" } }, required: ["device", "quando", "chi"] } },
  { name: "segna_imprevisto", description: "Segna un imprevisto che porta via tempo al percorso (malattia, lavoro in piu', un viaggio): l'app ricalcola subito l'arrivo previsto.",
    input_schema: { type: "object", properties: { device: { type: "string" }, giorni: { type: "number" }, ore: { type: "number", description: "ore di lavoro sul percorso che porta via" }, motivo: { type: "string" } }, required: ["device", "giorni"] } },
  /* app 0.9.380: con Premium la chiamata su misura la crea il tuo agente, dalla chat (Impostazioni della chiamata) */
  { name: "crea_condizione_chiamata", description: "Salva una condizione su misura per la chiamata dei sogni, quando la persona te lo chiede: per esempio aprire un'app che distrae dopo le 22, due giorni senza una tappa, un'idea che non c'entra con il piano. Scrivi quando deve squillare in una frase che capisce anche lei.",
    input_schema: { type: "object", properties: { device: { type: "string" }, nome: { type: "string", description: "un nome breve, es. Idea fuori rotta" }, quando: { type: "string", description: "quando deve squillare, in una frase intera" }, messaggio: { type: "string" } }, required: ["device", "nome", "quando"] } },
  /* app 0.9.403 (BUG-298): con il piano Pro l'agente rende automatica un'abitudine scritta dalla persona. La regola la sorveglia il telefono
     (www/js/partita-schede.js, pscAbAutoControlla) e spunta da sola il tracker; la spunta a mano resta. Senza il piano Pro il telefono tiene
     la regola spenta: il piano lo sa solo l'app (agDati.pianoPremium), qui non c'e' */
  { name: "crea_regola_abitudine", description: "Solo con il piano Pro (nei dati della persona pianoPremium = pro): rende automatica un'abitudine che la persona ha scritto (nei dati: abitudini), cosi' il tracker si spunta da solo. Tre tipi di regola: app (minuti su un'app in un giorno: piuDi spunta il giorno appena li supera, per un'abitudine da tenere; menoDi spunta il giorno se resta sotto, per un'abitudine da cambiare), fullfocus (una sessione di Full Focus riuscita di almeno minuti, con l'etichetta tag se la chiede), posizione (quando il telefono e' in un luogo: il luogo lo segna la persona dal foglio dell'abitudine, tu scrivi solo il nome). Una regola per abitudine: quella nuova sostituisce la vecchia. Con un altro piano non chiamarlo: digli che serve il piano Pro.",
    input_schema: { type: "object", properties: { device: { type: "string" }, abitudine: { type: "string", description: "il testo dell'abitudine come l'ha scritto la persona" }, tipo: { type: "string", enum: ["app", "fullfocus", "posizione"] }, app: { type: "string", description: "tipo app: il nome dell'app, es. Duolingo" }, piuDi: { type: "number", description: "tipo app: minuti, spunta se li supera" }, menoDi: { type: "number", description: "tipo app: minuti, spunta se resta sotto" }, minuti: { type: "number", description: "tipo fullfocus: durata minima, di base 20" }, tag: { type: "string", description: "tipo fullfocus: l'etichetta della sessione, es. Studio" }, luogo: { type: "string", description: "tipo posizione: il nome del luogo, es. Palestra" }, raggio: { type: "number", description: "tipo posizione: metri, di base 150" }, perche: { type: "string" } }, required: ["device", "abitudine", "tipo"] } },
];
const TIPO: Record<string, string> = { aggiorna_roadmap: "roadmap", crea_programma: "programma", crea_blocco_rapido: "blocco_rapido", crea_regola_partita: "regola", segna_imprevisto: "imprevisto", crea_condizione_chiamata: "chiamata", crea_regola_abitudine: "abitudine" };

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

export function registerDreamMapAgentTools(app: Express) {
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
    } else if (tool === "crea_regola_partita") {
      if (!QUANDO.includes(String(a.quando))) { res.status(400).json({ error: "momento sconosciuto: usa uno di " + QUANDO.join(", ") }); return; }
      payload = { nome: String(a.nome || "").slice(0, 80), quando: String(a.quando), chi: String(a.chi) === "vecchio" ? "vecchio" : "nuovo", punti: Math.max(1, Math.min(3, Math.round(Number(a.punti) || 1))), entro: ora(a.entro, ""), dopo: ora(a.dopo, ""), parole: lista(a.parole, 8), perche: String(a.perche || "").slice(0, 200),
        giorni: lista(a.giorni, 7).map((g: string) => g.toLowerCase().slice(0, 3)).filter((g: string) => GIORNI.includes(g)),
        piuDi: intero(a.piuDi, 1, 1440), menoDi: intero(a.menoDi, 1, 1440), app: String(a.app || "").slice(0, 60),
        dallaVolta: intero(a.dallaVolta, 2, 50), maxGiorno: intero(a.maxGiorno, 1, 20), almeno: intero(a.almeno, 1, 20),
        votoMax: intero(a.votoMax, 1, 5), votoMin: intero(a.votoMin, 1, 5) };
    } else if (tool === "crea_condizione_chiamata") {
      payload = { nome: String(a.nome || "").slice(0, 80), quando: String(a.quando || "").slice(0, 300), messaggio: String(a.messaggio || "").slice(0, 300) };
      if (!payload.nome || !payload.quando) { res.status(400).json({ error: "servono nome e quando" }); return; }
    } else if (tool === "crea_regola_abitudine") {
      const tipo = ["app", "fullfocus", "posizione"].includes(String(a.tipo)) ? String(a.tipo) : "";
      payload = { abitudine: String(a.abitudine || "").trim().slice(0, 120), tipo, app: String(a.app || "").trim().slice(0, 60),
        piuDi: intero(a.piuDi, 1, 1440), menoDi: intero(a.menoDi, 1, 1440), minuti: intero(a.minuti, 1, 480), tag: String(a.tag || "").trim().slice(0, 40),
        luogo: String(a.luogo || "").trim().slice(0, 60), raggio: intero(a.raggio, 50, 2000), perche: String(a.perche || "").slice(0, 200) };
      if (!payload.abitudine || !tipo) { res.status(400).json({ error: "servono l'abitudine e il tipo (app, fullfocus o posizione)" }); return; }
      if (tipo === "app" && !payload.app) { res.status(400).json({ error: "per il tipo app serve il nome dell'app" }); return; }
    } else if (tool === "segna_imprevisto") {
      payload = { giorni: Math.max(1, Math.min(60, Math.round(Number(a.giorni) || 1))), ore: Math.max(0, Math.min(400, Number(a.ore) || 0)), motivo: String(a.motivo || "").slice(0, 160) };
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
