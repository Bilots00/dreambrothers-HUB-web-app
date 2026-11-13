import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { rows } from "./focuslockSocial";
import { whoIs, isIdentity } from "./focuslockRoutes";

/* DreamMap: IL PONTE CON LE ALTRE AI (app 0.9.333).
 *
 * Andrea: "qualsiasi AI agentica l'utente usi, tutto quello su cui lavora deve arrivare al Genio, cosi' la sera sa
 * davvero se ha lavorato sul sogno". Si accende solo se l'utente lo chiede dall'app, e da li' ha una chiave sua:
 * con quella la sua AI scrive un riassunto di cosa ha fatto (mai la conversazione intera), e l'app lo rilegge.
 * Spegnendolo la chiave e tutto quello che era stato scritto spariscono.
 *
 * Due porte per la stessa cosa:
 *  - POST /api/focuslock/ponte/registra: per chi sa fare una chiamata HTTP;
 *  - POST /api/focuslock/ponte/mcp/:chiave: un server MCP (trasporto HTTP) con due strumenti, per Claude Code, Cursor e simili.
 *
 * App 0.9.351, "L'HO GIA' FATTA": una tappa della Roadmap fatta fuori dall'app si segna fatta solo dopo la verifica.
 *  - lo strumento MCP verifica_tappa: la sua AI conferma una tappa con la prova che ha visto (focuslock_ponte_verifiche);
 *  - POST /api/focuslock/roadmap/verifica: l'app chiede il giudizio; si leggono le prove che ci sono (i resoconti del
 *    ponte, le conferme con verifica_tappa, i messaggi con l'agente, le prove del telefono che manda l'app) e le giudica il
 *    modello che usa gia' il Genio (Gemini Flash-Lite, DREAMMAP_GEMINI_KEY). Senza prove: no, senza chiamare il modello.
 *  I bivi della roadmap (app 0.9.351): ogni anello puo' avere un "bivio" (la decisione alla revisione di quel periodo),
 *  e pulisciPiano lo tiene. */

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
      /* app 0.9.351: le tappe che la sua AI conferma fatte, con la prova (strumento verifica_tappa) */
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_ponte_verifiche (
        id INT AUTO_INCREMENT PRIMARY KEY,
        chiave VARCHAR(64) NOT NULL,
        tappa VARCHAR(300) NOT NULL,
        prova VARCHAR(1000) NOT NULL,
        fatta TINYINT NOT NULL DEFAULT 1,
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
/* app 0.9.351: il bivio strategico di un periodo, alla sua revisione ("resto sulla strada" o "cambio strategia"). Facoltativo:
 * una roadmap senza bivi resta valida come prima. */
const REVISIONI = ["settimana", "mese", "trimestre", "anno"];
function pulisciBivio(b: any, periodo: string): any {
  if (!b || typeof b !== "object") return null;
  const c = (t: unknown, n: number) => String(t ?? "").replace(/[«»“”]/g, "\"").replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
  const revisione = REVISIONI.includes(String(b.revisione)) ? String(b.revisione) : (REVISIONI.includes(periodo) ? periodo : "");
  const x = { revisione, domanda: c(b.domanda, 140), resto: c(b.resto, 60), cambio: c(b.cambio, 60) };
  return revisione && (x.domanda || x.resto || x.cambio) ? x : null;
}
function pulisciPiano(p: any): any {
  if (!p || typeof p !== "object") return null;
  const out: any = {};
  for (const k of ["cinque", "anno", "mese", "settimana", "oggi"]) {
    const x = p[k];
    if (!x || typeof x !== "object") continue;
    const testo = String(x.testo ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    const passi = (Array.isArray(x.passi) ? x.passi : []).map((t: any) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 180)).filter(Boolean).slice(0, 6);
    const bivio = pulisciBivio(x.bivio, k);
    if (testo || passi.length) out[k] = bivio ? { testo, passi, bivio } : { testo, passi };
  }
  const bivi = (Array.isArray(p.bivi) ? p.bivi : []).map((b: any) => pulisciBivio(b, "")).filter(Boolean).slice(0, 8);
  if (bivi.length) out.bivi = bivi;
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
/* app 0.9.351: la conferma della sua AI che una tappa e' fatta, con la prova. Non segna niente da sola: la legge la verifica. */
const MAX_VERIFICHE_GIORNO = 50;
async function scriviVerifica(chiave: string, a: any): Promise<string> {
  const tappa = String(a?.tappa ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const prova = String(a?.prova ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!tappa || !prova) throw new Error("Servono la tappa e la prova che hai visto.");
  const fatta = a?.fatta === false ? 0 : 1;
  const quanti = await rows(sql`SELECT COUNT(*) AS n FROM focuslock_ponte_verifiche WHERE chiave = ${chiave} AND createdAt > (NOW() - INTERVAL 1 DAY)`);
  if (Number(quanti[0]?.n || 0) >= MAX_VERIFICHE_GIORNO) throw new Error("troppe conferme oggi");
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  await db.execute(sql`INSERT INTO focuslock_ponte_verifiche (chiave, tappa, prova, fatta, createdAt) VALUES (${chiave}, ${tappa}, ${prova}, ${fatta}, NOW())`);
  await db.execute(sql`DELETE FROM focuslock_ponte_verifiche WHERE chiave = ${chiave} AND createdAt < (NOW() - INTERVAL 120 DAY)`);
  return fatta ? "Conferma registrata: nell'app l'utente tocca \"L'ho già fatta\" e il suo agente personale la legge." : "Registrato: la tappa è cominciata, non finita.";
}

/* app 0.9.351: il giudizio sulle tappe gia' fatte. Il modello e' quello che usa gia' il Genio (nessun servizio nuovo). */
function testoPulito(t: unknown, n: number): string { return String(t ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, n); }
function jsonIn(t: string): any { const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a < 0 || b <= a) return null; try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; } }
async function giudicaGemini(sistema: string, utente: string): Promise<any | null | "spento"> {
  const chiaveG = process.env.DREAMMAP_GEMINI_KEY || process.env.AGENT_GEMINI_KEY || "";
  if (!chiaveG) return "spento";
  const modello = process.env.DREAMMAP_VERIFICA_MODELLO || process.env.DREAMMAP_VAR_MODELLO || "gemini-3.5-flash-lite";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modello}:generateContent`, {
    method: "POST", headers: { "x-goog-api-key": chiaveG, "content-type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: sistema }] }, contents: [{ role: "user", parts: [{ text: utente }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 200, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" } } }),
  });
  const j: any = await r.json().catch(() => ({}));
  const t = r.ok ? (j?.candidates?.[0]?.content?.parts || []).map((x: any) => x.text || "").join("") : "";
  return t ? jsonIn(t) : null;
}
const VERIFICHE_USATE = new Map<string, { g: string; n: number }>();

const PASSI_DESCR = "Da 2 a 5 passi concreti. Ogni passo è una frase intera con il verbo all'inizio, produce qualcosa e dura almeno 25 minuti (mai una scelta da due secondi come 'scegliere lo strumento').";
const BIVIO = {
  type: "object",
  description: "Facoltativo, al massimo uno per periodo e mai a caso: il bivio strategico alla revisione di questo periodo, il momento in cui l'utente decide se restare sulla strada o cambiare strategia. Nasce da un'ipotesi del piano che il periodo mette alla prova.",
  properties: {
    revisione: { type: "string", enum: REVISIONI, description: "La revisione dopo cui arriva il bivio." },
    domanda: { type: "string", description: "La domanda della decisione, con il soggetto dentro, massimo 120 caratteri. Senza due punti, per esempio Se le prime vendite arrivano dalle inserzioni, resti sulle inserzioni o passi ai contenuti?" },
    resto: { type: "string", description: "La strada di adesso, in 2-5 parole." },
    cambio: { type: "string", description: "L'alternativa concreta, in 2-5 parole." },
  },
};
const ANELLO = { type: "object", properties: { testo: { type: "string", description: "Una frase: il traguardo di questo periodo." }, passi: { type: "array", items: { type: "string" }, description: PASSI_DESCR }, bivio: BIVIO }, required: ["testo", "passi"] };
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
    name: "verifica_tappa",
    description: "Conferma su DreamMap che l'utente ha già fatto una tappa della sua roadmap fuori dall'app, con la prova che hai visto. Usalo solo quando il lavoro finito si vede davvero in questa conversazione (un link pubblicato, un file, del codice, un risultato misurabile), mai solo perché l'utente dice di averlo fatto, e solo per cose che lasciano tracce digitali (non per cucinare, allenarsi o suonare). Nell'app l'utente tocca \"L'ho già fatta\" e il suo agente personale legge la tua conferma.",
    inputSchema: {
      type: "object",
      properties: {
        tappa: { type: "string", description: "Il testo della tappa, come è scritto nella roadmap (leggilo con leggi_piano)." },
        prova: { type: "string", description: "Cosa hai visto, in 1-3 frasi: il link, il file, il risultato." },
        fatta: { type: "boolean", description: "true se la tappa è finita, false se è solo cominciata." },
      },
      required: ["tappa", "prova"],
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
        instructions: "All'inizio leggi il piano con leggi_piano. Alla fine di ogni lavoro scrivi un riassunto con registra_lavoro: cosa avete fatto, su quale task, e se era la priorità del piano. Se l'utente ti chiede la sua roadmap, fagli le domande una alla volta e poi scrivila con scrivi_roadmap. Se ti chiede il resoconto della sera, riassumi in registra_lavoro tutto quello su cui avete lavorato oggi e, se il piano non torna più con quello che sta facendo, aggiorna la roadmap con scrivi_roadmap. Quando vedi finita una tappa della roadmap (un link pubblicato, un file, del codice), confermala con verifica_tappa e la prova: mai solo sulla parola.",
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
        if (nome === "verifica_tappa") return ok({ content: [{ type: "text", text: await scriviVerifica(chiave, a) }] });
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
  /* app 0.9.351: "L'ho gia' fatta". Body: { sogno, tappe: [{ id, t }], prove: [testo], chiave?, nomeAgente? }.
   * Risponde { ok, motivo, verificabile }. Con il token Google dell'utente (l'app lo manda con accountApi). */
  app.post("/api/focuslock/roadmap/verifica", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    const b = req.body ?? {};
    const tappe = (Array.isArray(b.tappe) ? b.tappe : []).slice(0, 20).map((x: any) => ({ id: testoPulito(x?.id, 40), t: testoPulito(x?.t, 240) })).filter((x: any) => x.t);
    if (!tappe.length) { res.status(400).json({ error: "nessuna tappa" }); return; }
    const g = new Date().toISOString().slice(0, 10);
    const u = VERIFICHE_USATE.get(who.sub); const n = u && u.g === g ? u.n : 0;
    if (n >= 40) { res.status(429).json({ error: "troppe verifiche oggi", motivo: "Hai chiesto troppe verifiche oggi: riprova domani." }); return; }
    VERIFICHE_USATE.set(who.sub, { g, n: n + 1 });
    if (VERIFICHE_USATE.size > 20000) VERIFICHE_USATE.clear();
    const sogno = testoPulito(b.sogno, 300);
    const nome = testoPulito(b.nomeAgente, 40).replace(/[<>{}\[\]`*_#|\\"]/g, "") || "il tuo agente personale";
    const prove = (Array.isArray(b.prove) ? b.prove : []).slice(0, 60).map((x: any) => testoPulito(x, 260)).filter(Boolean);
    const chiave = String(b.chiave || "");
    let resoconti: string[] = [], conferme: string[] = [], chat: string[] = [];
    try {
      await ensure();
      if (await esiste(chiave)) {
        const l = await rows(sql`SELECT fonte, testo, minuti, DATE_FORMAT(createdAt, '%d/%m') AS g FROM focuslock_ponte_log WHERE chiave = ${chiave} AND createdAt > (NOW() - INTERVAL 60 DAY) ORDER BY id DESC LIMIT 80`);
        resoconti = l.map((x: any) => "[" + String(x.g) + ", " + String(x.fonte) + (Number(x.minuti) ? ", " + Number(x.minuti) + " minuti" : "") + "] " + testoPulito(x.testo, 300));
        const v = await rows(sql`SELECT tappa, prova, fatta, DATE_FORMAT(createdAt, '%d/%m') AS g FROM focuslock_ponte_verifiche WHERE chiave = ${chiave} AND createdAt > (NOW() - INTERVAL 120 DAY) ORDER BY id DESC LIMIT 40`);
        conferme = v.map((x: any) => "[" + String(x.g) + (Number(x.fatta) ? ", finita" : ", solo cominciata") + "] Tappa: " + testoPulito(x.tappa, 240) + ". Prova: " + testoPulito(x.prova, 400));
      }
    } catch { /* senza ponte si giudica con il resto */ }
    try {
      const m = await rows(sql`SELECT direzione, testo, DATE_FORMAT(createdAt, '%d/%m') AS g FROM focuslock_agent_msgs WHERE googleSub = ${who.sub} AND createdAt > (NOW() - INTERVAL 30 DAY) ORDER BY id DESC LIMIT 24`);
      chat = m.map((x: any) => "[" + String(x.g) + ", " + (String(x.direzione) === "in" ? "la persona" : "l'agente") + "] " + testoPulito(x.testo, 300));
    } catch { /* la tabella dei messaggi puo' non esserci ancora */ }
    if (!resoconti.length && !conferme.length && !prove.length) {
      res.json({ ok: false, verificabile: true, motivo: "Non trovo ancora prove, quindi chiedi alla tua AI collegata di confermarla con verifica_tappa." });
      return;
    }
    const sistema = [
      `Sei ${nome}, l'agente personale di questa persona dentro DreamMap. Ti chiede di segnare come fatte una o più tappe della sua roadmap, che dice di aver già fatto fuori dall'app. Sei un verificatore severo e giusto: proteggi la sua strada dagli imbrogli, anche da quelli che fa a se stessa.`,
      "1. Prima decidi se le tappe si possono verificare da remoto: lasciano tracce digitali (un negozio online, un'app, un sito, un software, contenuti pubblicati, email inviate, file, codice). Cucinare, allenarsi, suonare, una cosa fatta a mano o lontano dallo schermo: \"verificabile\" è false e \"ok\" è false.",
      "2. Una tappa è fatta solo se le PROVE la mostrano in modo concreto: un resoconto di una sua AI che descrive quel lavoro finito, una conferma data con verifica_tappa con una prova (link, file, risultato), sessioni di Full Focus su quella cosa con un tempo credibile, il passo spuntato nella roadmap. Quello che la persona dice di sé all'agente non basta da solo.",
      "3. Se le tappe sono più di una, l'ultima è quella toccata: \"ok\" è true solo se le prove mostrano l'ultima e rendono credibili le altre. Nel dubbio false.",
      "4. \"motivo\": UNA frase, massimo 22 parole, in italiano, con il tu e con il verbo, che dice su quale prova ti basi o quale prova manca. Senza due punti, numeri in cifre, virgolette solo \"\", mai il trattino lungo, mai prediche.",
      "Rispondi SOLO in JSON: {\"verificabile\": true, \"ok\": false, \"motivo\": \"...\"}",
    ].join("\n");
    const lista = (t: string[]) => (t.length ? t.map((x) => "- " + x).join("\n") : "(niente)");
    const utenteTxt = "Il sogno: " + (sogno || "non indicato")
      + "\n\nLe tappe da segnare fatte (l'ultima è quella toccata):\n" + tappe.map((x: any, i: number) => (i + 1) + ". " + x.t).join("\n")
      + "\n\nCONFERME DATE DALLA SUA AI CON verifica_tappa:\n" + lista(conferme)
      + "\n\nRESOCONTI DELLE SUE AI (il ponte, ultimi 60 giorni):\n" + lista(resoconti)
      + "\n\nPROVE DAL TELEFONO (sessioni di Full Focus, passi spuntati):\n" + lista(prove)
      + "\n\nMESSAGGI CON L'AGENTE (contesto, non sono prove da soli):\n" + lista(chat);
    try {
      const j = await giudicaGemini(sistema, utenteTxt);
      if (j === "spento") { res.status(503).json({ error: "la verifica non ha un modello acceso", spento: true }); return; }
      if (!j || typeof j !== "object") { res.status(502).json({ error: "il modello non ha risposto in un modo che si legge" }); return; }
      const verificabile = j.verificabile !== false;
      const motivo = testoPulito(j.motivo, 200).replace(/[«»“”]/g, "\"").replace(/\s*[—–]\s*/g, ", ")
        || (verificabile ? "Le prove che ho non mostrano questa tappa finita." : "Questa tappa non lascia tracce che io possa vedere.");
      res.json({ ok: verificabile && j.ok === true, verificabile, motivo });
    } catch (e: any) {
      res.status(502).json({ error: "verifica: " + (e?.message || String(e)) });
    }
  });
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
