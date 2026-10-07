import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "../db";
import { rows } from "./focuslockRoutes";

/* Focus2Dream — la sfida del Genio (app 0.9.190): il gioco alla Akinator che si apre dal
 * pulsante bianco della copertina di Dream.
 *
 * IL GIOCO VIVE SUL TELEFONO. Il motore (www/js/genio-motore.js) e i cataloghi di personaggi,
 * libri e film girano senza internet. Il server serve a due cose sole:
 *
 * 1. IL CERVELLO GRANDE (/pensa). Quando il catalogo del telefono non conosce la risposta, il
 *    Genio manda qui le domande e le risposte della partita, e Claude decide la mossa dopo: una
 *    domanda nuova o un'ipotesi. Si accende solo se c'e' AGENT_LLM_KEY (la stessa chiave a
 *    consumo dell'agente). Senza, /stato risponde profondo:false e l'app non lo chiede mai.
 *
 * 2. L'APPRENDIMENTO, come Limule. Ogni partita finita con la risposta giusta arriva qui
 *    (/partita): le risposte date si sommano alle statistiche di quella entita', e l'app le
 *    scarica (/appresi) e le usa al posto dell'annotazione di partenza. Le entita' che il
 *    catalogo non ha, insegnate da chi ha perso, entrano per tutti quando almeno DUE telefoni
 *    diversi hanno insegnato lo stesso nome E quel nome e' una pagina di Wikipedia: e' il
 *    filtro che tiene fuori i nomi di privati, gli scherzi e le parolacce.
 *
 * Niente account: le rotte sono pubbliche, con un tetto per indirizzo. Nessun dato personale:
 * domande del gioco, risposte del gioco, un id casuale del telefono. Le rotte rispondono con i
 * permessi CORS (il telefono passa dal canale nativo, il computer e il browser no). */

const DOMINI = ["personaggi", "libri", "film"] as const;
type Dominio = (typeof DOMINI)[number];
const RISPOSTE = ["si", "ps", "ns", "pn", "no"];
const ETICHETTE = ["Sì", "Probabilmente sì", "Non lo so", "Probabilmente no", "No"];
const ESITI = ["vinto", "perso", "insegnato", "nuovo"];
const SOGGETTO: Record<Dominio, string> = { personaggi: "Il tuo personaggio", libri: "Il tuo libro", film: "Il tuo film" };
const COSA: Record<Dominio, string> = {
  personaggi: "a character: a real person (alive or dead) or a fictional character (cartoons, anime, video games, comics, films, TV series, books, myths)",
  libri: "a book (novels, classics, sagas, self-help and business books, comics and manga in volumes, sacred texts)",
  film: "a film or a TV series",
};

let ready: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_genio_partite (
        id INT AUTO_INCREMENT PRIMARY KEY,
        dominio VARCHAR(16) NOT NULL,
        esito VARCHAR(12) NOT NULL,
        entita VARCHAR(80) NULL,
        nome VARCHAR(120) NULL,
        norma VARCHAR(80) NULL,
        wiki VARCHAR(200) NULL,
        risposte TEXT NULL,
        libere TEXT NULL,
        n INT NULL,
        dev VARCHAR(48) NULL,
        createdAt TIMESTAMP NULL,
        KEY idx_dom (dominio, id),
        KEY idx_norma (dominio, norma)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_genio_nuove (
        id INT AUTO_INCREMENT PRIMARY KEY,
        dominio VARCHAR(16) NOT NULL,
        norma VARCHAR(80) NOT NULL,
        nome VARCHAR(160) NULL,
        wiki VARCHAR(200) NULL,
        descrizione VARCHAR(200) NULL,
        img VARCHAR(500) NULL,
        cr VARCHAR(220) NULL,
        stato VARCHAR(10) NOT NULL DEFAULT 'attesa',
        checkedAt TIMESTAMP NULL,
        UNIQUE KEY uniq_dn (dominio, norma)
      )`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

function cors(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}
function ipDi(req: Request): string {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim().slice(0, 64);
}
/* il tetto per indirizzo: una finestra mobile in memoria (basta: un riavvio la azzera) */
const finestre = new Map<string, number[]>();
function troppe(chiave: string, max: number, ms: number): boolean {
  const ora = Date.now();
  const v = (finestre.get(chiave) || []).filter((t) => ora - t < ms);
  if (v.length >= max) { finestre.set(chiave, v); return true; }
  v.push(ora); finestre.set(chiave, v);
  if (finestre.size > 20000) finestre.clear();
  return false;
}
function norma(s: unknown): string {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/^(il|lo|la|i|gli|le|l'|un|una|uno|the)\s+/, "").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
}
function dominio(x: unknown): Dominio | null { return (DOMINI as readonly string[]).includes(String(x)) ? (x as Dominio) : null; }
const PAROLACCE = /\b(cazz|merd|stronz|puttan|troi|vaffanc|coglion|fanculo|figa|minchi|porco ?dio|dio ?cane|fuck|shit|bitch|nigg|negr)/i;

/* ---------------------------------------------------------------------------------------
 * WIKIPEDIA: chi e' (o cos'e') un nome, e la foto se e' libera
 * --------------------------------------------------------------------------------------- */
const UA = { "User-Agent": "Focus2Dream-Genio/1.0 (info@dreambrothers.it)" };
type Wiki = { titolo: string; lingua: string; descrizione: string; img: string; cr: string };
async function wikiRiassunto(lingua: string, titolo: string): Promise<any | null> {
  try {
    const r = await fetch(`https://${lingua}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titolo.replace(/ /g, "_"))}`, { headers: UA });
    if (!r.ok) return null;
    const j: any = await r.json();
    if (!j || j.type === "disambiguation" || !j.title) return null;
    return j;
  } catch { return null; }
}
async function wikiCerca(lingua: string, testo: string): Promise<string | null> {
  try {
    const r = await fetch(`https://${lingua}.wikipedia.org/w/api.php?action=opensearch&limit=1&namespace=0&format=json&search=${encodeURIComponent(testo)}`, { headers: UA });
    if (!r.ok) return null;
    const j: any = await r.json();
    return (j && j[1] && j[1][0]) ? String(j[1][0]) : null;
  } catch { return null; }
}
/** La foto: SOLO se sta su Wikimedia Commons (licenza libera), con autore e licenza. */
async function wikiFoto(j: any): Promise<{ img: string; cr: string }> {
  const orig = String(j?.originalimage?.source || "");
  const thumb = String(j?.thumbnail?.source || "").replace(/\?.*$/, "");
  if (!/wikipedia\/commons\//.test(orig + thumb)) return { img: "", cr: "" };
  let cr = "";
  try {
    const file = decodeURIComponent(orig.replace(/\?.*$/, "").split("/").pop() || "");
    if (file) {
      const r = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata&format=json&titles=${encodeURIComponent("File:" + file)}`, { headers: UA });
      const k: any = r.ok ? await r.json() : null;
      const pag: any = k && k.query && k.query.pages ? Object.values(k.query.pages)[0] : null;
      const m = pag && pag.imageinfo && pag.imageinfo[0] && pag.imageinfo[0].extmetadata;
      const autore = String(m?.Artist?.value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
      const lic = String(m?.LicenseShortName?.value || "").trim().slice(0, 40);
      cr = ("Foto: " + [autore, lic].filter(Boolean).join(" · ") + " · Wikimedia Commons").slice(0, 200);
    }
  } catch { }
  return { img: thumb || orig.replace(/\?.*$/, ""), cr };
}
/** Trova la pagina: titolo esatto (it, poi en), altrimenti la ricerca. */
async function wikiTrova(nome: string, suggerito?: string): Promise<Wiki | null> {
  const tentativi: [string, string][] = [];
  if (suggerito) {
    const m = /^(it|en):(.+)$/.exec(suggerito.trim());
    if (m) tentativi.push([m[1], m[2]]); else tentativi.push(["it", suggerito.trim()]);
  }
  tentativi.push(["it", nome]);
  for (const [lingua, titolo] of tentativi) {
    const j = await wikiRiassunto(lingua, titolo);
    if (j) { const f = await wikiFoto(j); return { titolo: j.title, lingua, descrizione: String(j.description || "").slice(0, 160), img: f.img, cr: f.cr }; }
  }
  for (const lingua of ["it", "en"]) {
    const t = await wikiCerca(lingua, nome);
    if (!t) continue;
    /* la ricerca trova sempre qualcosa: vale solo se il titolo somiglia davvero al nome */
    const a = norma(t), b = norma(nome);
    if (!(a.includes(b) || b.includes(a))) continue;
    const j = await wikiRiassunto(lingua, t);
    if (j) { const f = await wikiFoto(j); return { titolo: j.title, lingua, descrizione: String(j.description || "").slice(0, 160), img: f.img, cr: f.cr }; }
  }
  return null;
}

/* ---------------------------------------------------------------------------------------
 * IL CERVELLO GRANDE: Claude decide la mossa dopo
 * --------------------------------------------------------------------------------------- */
let CLAUDE: Anthropic | null = null;
function claude(): Anthropic {
  if (!CLAUDE) CLAUDE = new Anthropic({ apiKey: String(process.env.AGENT_LLM_KEY) });
  return CLAUDE;
}
function profondoAcceso(): boolean { return !!process.env.AGENT_LLM_KEY && !/^(0|false|no)$/i.test(String(process.env.GENIO_PROFONDO || "")); }
const MAX_GIORNO = Math.max(0, Math.floor(Number(process.env.GENIO_MAX_GIORNO || 4000)));
let oggi = "", usatiOggi = 0;
function contaOggi(): boolean {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== oggi) { oggi = d; usatiOggi = 0; }
  if (usatiOggi >= MAX_GIORNO) return false;
  usatiOggi++;
  return true;
}
const SCHEMA_MOSSA = {
  type: "object",
  properties: {
    tipo: { type: "string", enum: ["domanda", "ipotesi"] },
    testo: { type: "string" },
    nome: { type: "string" },
    descrizione: { type: "string" },
    wiki: { type: "string" },
    fiducia: { type: "number" },
  },
  required: ["tipo", "testo", "nome", "descrizione", "wiki", "fiducia"],
  additionalProperties: false,
};
function istruzioni(d: Dominio): string {
  return [
    `You are the Genie of an Akinator-style guessing game inside an Italian mobile app (Focus2Dream). The player is thinking of ${COSA[d]}. You find it by asking yes/no questions, then guessing.`,
    "You receive: the questions already asked (in Italian) with the player's answer to each, one of «Sì», «Probabilmente sì», «Non lo so», «Probabilmente no», «No»; the guesses that were already wrong; and the local catalog's best candidates with their probability. Players make mistakes, so treat one contradictory answer as noise, not proof. The candidates are only hints: you are being called because the local catalog probably does NOT contain the answer.",
    "Choose the single best next move.",
    `- "ipotesi" when you are fairly confident (about 60% or more) about one specific, publicly known ${d === "personaggi" ? "person or fictional character" : d === "libri" ? "book" : "film or TV series"}, or when "passo" is 9 or more. Set nome to the name an Italian player would use (Italian title for books, films and series), descrizione to a short Italian description of at most 60 characters (e.g. "YouTuber italiano di videogiochi", "romanzo di Italo Calvino", "film di Christopher Nolan, 2010"), wiki to the exact title of its Italian Wikipedia page prefixed with "it:" if you are sure it exists, otherwise the English Wikipedia title prefixed with "en:", otherwise an empty string; set testo to an empty string.`,
    `- "domanda" otherwise. testo is ONE new yes/no question in natural Italian, at most 90 characters, starting with "${SOGGETTO[d]}", that splits the likely remaining answers roughly in half and that a typical player can answer. Never repeat or rephrase a question already asked. Set nome, descrizione and wiki to empty strings.`,
    "fiducia: your confidence, from 0 to 1, in your current best candidate.",
    "Never guess a name listed among the wrong guesses. Only publicly known people, works or fictional characters: never a private individual.",
  ].join("\n");
}
type Mossa = { tipo: "domanda" | "ipotesi"; testo: string; nome: string; descrizione: string; wiki: string; fiducia: number };
async function chiediMossa(d: Dominio, domande: { d: string; r: string }[], esclusi: string[], candidati: { n: string; p: number }[], passo: number): Promise<Mossa | null> {
  const testo = [
    `passo: ${passo}`,
    "Domande e risposte:",
    ...domande.map((x, i) => `${i + 1}. ${x.d} → ${x.r}`),
    "",
    "Ipotesi già sbagliate: " + (esclusi.length ? esclusi.join("; ") : "nessuna"),
    "Candidati del catalogo locale: " + (candidati.length ? candidati.map((c) => `${c.n} (${Math.round(c.p * 100)}%)`).join("; ") : "nessuno"),
  ].join("\n");
  /* Opus 5.5 a sforzo basso: e' un turno di gioco, la risposta deve arrivare in pochi secondi.
   * Il formato e' imposto dallo schema (structured outputs): niente JSON da indovinare.
   * fallbacks "default": se un classificatore declina, la richiesta riparte da sola sul modello
   * che Anthropic indica per quella categoria. */
  const r: any = await (claude().beta.messages.create as any)({
    model: process.env.GENIO_MODEL || "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA_MOSSA } },
    system: istruzioni(d),
    messages: [{ role: "user", content: testo }],
  });
  if (!r || r.stop_reason === "refusal" || r.stop_reason === "max_tokens") return null;
  const t = (r.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t);
    if (j.tipo !== "domanda" && j.tipo !== "ipotesi") return null;
    return {
      tipo: j.tipo, testo: String(j.testo || "").slice(0, 160), nome: String(j.nome || "").slice(0, 120),
      descrizione: String(j.descrizione || "").slice(0, 120), wiki: String(j.wiki || "").slice(0, 200),
      fiducia: Math.max(0, Math.min(1, Number(j.fiducia) || 0)),
    };
  } catch { return null; }
}

/* ---------------------------------------------------------------------------------------
 * L'APPRENDIMENTO: le statistiche delle partite vere, e le entita' nuove
 * --------------------------------------------------------------------------------------- */
const CACHE_APPRESI = new Map<string, { at: number; body: any }>();
function contaRisposte(dest: Record<string, number[]>, risposte: any) {
  if (!risposte || typeof risposte !== "object") return;
  for (const q of Object.keys(risposte)) {
    const i = RISPOSTE.indexOf(String(risposte[q]));
    if (i < 0 || !/^[a-z0-9_]{1,24}$/.test(q)) continue;
    const c = dest[q] = dest[q] || [0, 0, 0, 0, 0];
    c[i]++;
  }
}
async function appresi(d: Dominio): Promise<any> {
  const c = CACHE_APPRESI.get(d);
  if (c && Date.now() - c.at < 10 * 60000) return c.body;
  await ensureTables();
  const out: Record<string, Record<string, number[]>> = {};
  /* QUANTE VOLTE OGNI ENTITA' E' STATA LA RISPOSTA: e' il «a chi pensa la gente» di Akinator.
   * L'app lo usa per alzare la probabilita' di partenza di chi esce piu' spesso. */
  const volte: Record<string, number> = {};
  const vinte = await rows(sql`SELECT entita, risposte FROM focuslock_genio_partite
    WHERE dominio = ${d} AND entita IS NOT NULL AND esito IN ('vinto', 'insegnato') ORDER BY id DESC LIMIT 20000`);
  for (const r of vinte) {
    let ris: any = null; try { ris = JSON.parse(String(r.risposte || "{}")); } catch { }
    contaRisposte(out[String(r.entita)] = out[String(r.entita)] || {}, ris);
    volte[String(r.entita)] = (volte[String(r.entita)] || 0) + 1;
  }
  /* LE ENTITA' NUOVE: almeno due telefoni diversi, e una pagina di Wikipedia */
  const gruppi = await rows(sql`SELECT norma, MAX(nome) AS nome, MAX(wiki) AS wiki, COUNT(DISTINCT dev) AS devs
    FROM focuslock_genio_partite WHERE dominio = ${d} AND norma IS NOT NULL AND norma <> ''
    GROUP BY norma HAVING COUNT(DISTINCT dev) >= 2 ORDER BY devs DESC LIMIT 400`);
  const nuove: any[] = [];
  let controllate = 0;
  for (const g of gruppi) {
    const nm = String(g.norma);
    let v = (await rows(sql`SELECT * FROM focuslock_genio_nuove WHERE dominio = ${d} AND norma = ${nm} LIMIT 1`))[0];
    if (!v && controllate < 12) {
      controllate++;
      const nome = String(g.nome || nm);
      const w = PAROLACCE.test(nome) ? null : await wikiTrova(nome, g.wiki ? String(g.wiki) : undefined);
      await rows(sql`INSERT IGNORE INTO focuslock_genio_nuove (dominio, norma, nome, wiki, descrizione, img, cr, stato, checkedAt)
        VALUES (${d}, ${nm}, ${w ? w.titolo : nome}, ${w ? w.lingua + ":" + w.titolo : null}, ${w ? w.descrizione : null},
                ${w ? w.img : null}, ${w ? w.cr : null}, ${w ? "ok" : "no"}, NOW())`);
      v = (await rows(sql`SELECT * FROM focuslock_genio_nuove WHERE dominio = ${d} AND norma = ${nm} LIMIT 1`))[0];
    }
    if (!v || v.stato !== "ok") continue;
    const conteggi: Record<string, number[]> = {};
    const partite = await rows(sql`SELECT risposte FROM focuslock_genio_partite WHERE dominio = ${d} AND norma = ${nm} ORDER BY id DESC LIMIT 200`);
    for (const p of partite) { let ris: any = null; try { ris = JSON.parse(String(p.risposte || "{}")); } catch { } contaRisposte(conteggi, ris); }
    nuove.push({ id: "w_" + nm.replace(/ /g, "_").slice(0, 60), n: String(v.nome || nm), d: String(v.descrizione || ""), w: String(v.wiki || ""),
                 img: String(v.img || ""), cr: String(v.cr || ""), pop: 2, conteggi });
  }
  const body = { ok: true, dominio: d, appresi: out, volte, nuove, partite: vinte.length };
  CACHE_APPRESI.set(d, { at: Date.now(), body });
  return body;
}

/* ---------------------------------------------------------------------------------------
 * LE ROTTE
 * --------------------------------------------------------------------------------------- */
/* ---------------------------------------------------------------------------------------
 * UNA MANO SU UNA COSA DA FARE (0.9.206): la riga del foglio, dove la persona si blocca, il suo
 * sogno e il suo freno. Claude risponde con i passi (da dove si parte, in ordine) e con due o
 * tre ricerche per un tutorial. Tetto per telefono al giorno: il costo si regge cosi'.
 * --------------------------------------------------------------------------------------- */
const SCHEMA_AIUTO = {
  type: "object", additionalProperties: false,
  properties: {
    nota: { type: "string", description: "Una frase, calda e diretta, che dice da dove si parte (max 160 caratteri)" },
    passi: { type: "array", items: { type: "string" }, description: "Da 3 a 6 passi concreti, ognuno fattibile in meno di 25 minuti, con un verbo all'inizio" },
    query: { type: "array", items: { type: "string" }, description: "2 o 3 ricerche in italiano per trovare un video tutorial passo passo su YouTube" }
  },
  required: ["nota", "passi", "query"],
};
const AIUTI = new Map<string, { g: string; n: number }>();
const AIUTI_MAX = Math.max(1, Math.floor(Number(process.env.AIUTO_MAX_GIORNO || 12)));
async function aiutoPensa(task: string, domanda: string, ctx: any): Promise<any | null> {
  const sys = [
    "Sei l'agente personale di DreamMap, un'app italiana che aiuta a realizzare un sogno con una tappa al giorno.",
    "Chi ti scrive e' bloccato su una cosa da fare oggi. Rispondi in italiano, con il tu, senza premesse e senza moralismi.",
    "Dai i passi nell'ordine in cui si fanno: il primo deve essere cosi' piccolo da poterlo fare in due minuti (aprire un file, scrivere una riga, telefonare a una persona).",
    "Ogni passo sta dentro una sessione di 25 minuti. Niente teoria: azioni. Se un passo si impara meglio guardando, dillo nel passo.",
    "Le ricerche per il tutorial: in italiano, concrete, come le scriverebbe una persona su YouTube (es. «come aprire partita iva forfettaria 2026 tutorial»).",
    ctx && ctx.freno ? "Tieni conto del suo freno: " + String(ctx.freno).slice(0, 200) : "",
  ].filter(Boolean).join("\n");
  const testo = ["Cosa deve fare: " + task, "Dove si blocca: " + domanda, ctx && ctx.sogno ? "Il suo sogno: " + String(ctx.sogno).slice(0, 200) : "", ctx && ctx.profilo ? "Chi e' oggi: " + String(ctx.profilo).slice(0, 80) : ""].filter(Boolean).join("\n");
  const r: any = await (claude().beta.messages.create as any)({
    model: process.env.GENIO_MODEL || "claude-opus-5-5",
    max_tokens: 1500,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA_AIUTO } },
    system: sys,
    messages: [{ role: "user", content: testo }],
  });
  if (!r || r.stop_reason === "refusal" || r.stop_reason === "max_tokens") return null;
  const t = (r.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  try {
    const j = JSON.parse(t);
    return { nota: String(j.nota || "").slice(0, 200), passi: (Array.isArray(j.passi) ? j.passi : []).slice(0, 6).map((x: any) => String(x).slice(0, 160)), query: (Array.isArray(j.query) ? j.query : []).slice(0, 3).map((x: any) => String(x).slice(0, 100)) };
  } catch { return null; }
}

export function registerFocusLockGenioRoutes(app: Express) {
  app.post("/api/focuslock/aiuto", async (req: Request, res: Response) => {
    const b = req.body || {};
    const device = String(b.device || "").slice(0, 64);
    const task = String(b.task || "").trim().slice(0, 200);
    const domanda = String(b.domanda || "").trim().slice(0, 500);
    if (!device || !task || !domanda) { res.status(400).json({ error: "manca la cosa da fare o la domanda" }); return; }
    if (!process.env.AGENT_LLM_KEY) { res.status(503).json({ error: "l'agente non e' acceso su questo server" }); return; }
    const g = new Date().toISOString().slice(0, 10);
    const u = AIUTI.get(device);
    const n = u && u.g === g ? u.n : 0;
    if (n >= AIUTI_MAX) { res.status(429).json({ error: "gli aiuti di oggi sono finiti" }); return; }
    AIUTI.set(device, { g, n: n + 1 });
    try {
      const r = await aiutoPensa(task, domanda, b.contesto || {});
      if (!r) { res.status(502).json({ error: "l'agente non ha risposto" }); return; }
      res.json(r);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "aiuto non disponibile" });
    }
  });

  app.options("/api/focuslock/genio/:x", (_req: Request, res: Response) => { cors(res); res.status(204).end(); });

  app.get("/api/focuslock/genio/stato", (_req: Request, res: Response) => {
    cors(res);
    res.json({ ok: true, profondo: profondoAcceso() && (oggi !== new Date().toISOString().slice(0, 10) || usatiOggi < MAX_GIORNO) });
  });

  app.post("/api/focuslock/genio/pensa", async (req: Request, res: Response) => {
    cors(res);
    if (!profondoAcceso()) { res.json({ ok: false, spento: true }); return; }
    const b = req.body || {};
    const d = dominio(b.dominio);
    if (!d) { res.status(400).json({ error: "dominio" }); return; }
    const ip = ipDi(req);
    if (troppe("pensa:" + ip, 90, 3600000)) { res.status(429).json({ error: "troppe richieste" }); return; }
    const domande = (Array.isArray(b.domande) ? b.domande : []).slice(0, 80)
      .map((x: any) => ({ d: String(x && x.d || "").slice(0, 200), r: String(x && x.r || "") }))
      .filter((x: any) => x.d && ETICHETTE.includes(x.r));
    if (domande.length < 3) { res.status(400).json({ error: "troppo presto" }); return; }
    const esclusi = (Array.isArray(b.esclusi) ? b.esclusi : []).slice(0, 12).map((x: any) => String(x).slice(0, 100)).filter(Boolean);
    const candidati = (Array.isArray(b.candidati) ? b.candidati : []).slice(0, 5)
      .map((x: any) => ({ n: String(x && x.n || "").slice(0, 100), p: Math.max(0, Math.min(1, Number(x && x.p) || 0)) })).filter((x: any) => x.n);
    const passo = Math.max(0, Math.min(30, Math.floor(Number(b.passo) || 0)));
    if (!contaOggi()) { res.json({ ok: false, limite: true }); return; }
    try {
      const m = await chiediMossa(d, domande, esclusi, candidati, passo);
      if (!m) { res.json({ ok: false }); return; }
      if (m.tipo === "ipotesi") {
        if (!m.nome || esclusi.some((x: string) => norma(x) === norma(m.nome))) { res.json({ ok: false }); return; }
        const w = await wikiTrova(m.nome, m.wiki || undefined);
        res.json({ ok: true, tipo: "ipotesi", nome: m.nome, descrizione: m.descrizione || (w ? w.descrizione : ""),
                   wiki: w ? w.lingua + ":" + w.titolo : "", img: w ? w.img : "", cr: w ? w.cr : "", fiducia: m.fiducia });
        return;
      }
      if (!m.testo) { res.json({ ok: false }); return; }
      res.json({ ok: true, tipo: "domanda", testo: m.testo, fiducia: m.fiducia });
    } catch (e: any) {
      console.error("[genio] pensa", e?.message || e);
      res.json({ ok: false });
    }
  });

  app.post("/api/focuslock/genio/partita", async (req: Request, res: Response) => {
    cors(res);
    const b = req.body || {};
    const d = dominio(b.dominio);
    const esito = String(b.esito || "");
    if (!d || !ESITI.includes(esito)) { res.status(400).json({ error: "dati" }); return; }
    const ip = ipDi(req);
    if (troppe("partita:" + ip, 150, 3600000)) { res.status(429).json({ error: "troppe partite" }); return; }
    const risposte: Record<string, string> = {};
    if (b.risposte && typeof b.risposte === "object") {
      for (const q of Object.keys(b.risposte).slice(0, 140)) {
        const v = String(b.risposte[q]);
        if (/^[a-z0-9_]{1,24}$/.test(q) && RISPOSTE.includes(v)) risposte[q] = v;
      }
    }
    const libere = (Array.isArray(b.libere) ? b.libere : []).slice(0, 20)
      .map((x: any) => ({ d: String(x && x.d || "").slice(0, 200), r: RISPOSTE.includes(String(x && x.r)) ? String(x.r) : "ns" }));
    const entita = /^[a-z0-9_]{1,80}$/.test(String(b.entita || "")) ? String(b.entita) : null;
    let nome = String(b.nome || (b.esterna && b.esterna.n) || "").replace(/\s+/g, " ").trim().slice(0, 100) || null;
    if (nome && PAROLACCE.test(nome)) nome = null;
    const wiki = b.esterna && b.esterna.w ? String(b.esterna.w).slice(0, 200) : null;
    const dev = /^[a-z0-9]{6,48}$/i.test(String(b.dev || "")) ? String(b.dev) : "ip" + ip.replace(/[^a-z0-9]/gi, "").slice(0, 40);
    try {
      await ensureTables();
      await rows(sql`INSERT INTO focuslock_genio_partite (dominio, esito, entita, nome, norma, wiki, risposte, libere, n, dev, createdAt)
        VALUES (${d}, ${esito}, ${entita}, ${nome}, ${nome && !entita ? norma(nome) : null}, ${wiki},
                ${JSON.stringify(risposte)}, ${JSON.stringify(libere)}, ${Math.max(0, Math.min(99, Math.floor(Number(b.n) || 0)))}, ${dev}, NOW())`);
      CACHE_APPRESI.delete(d);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[genio] partita", e?.message || e);
      res.status(500).json({ error: "salvataggio" });
    }
  });

  app.get("/api/focuslock/genio/appresi", async (req: Request, res: Response) => {
    cors(res);
    const d = dominio(req.query.dominio);
    if (!d) { res.status(400).json({ error: "dominio" }); return; }
    if (troppe("appresi:" + ipDi(req), 60, 3600000)) { res.status(429).json({ error: "troppe richieste" }); return; }
    try { res.json(await appresi(d)); }
    catch (e: any) { console.error("[genio] appresi", e?.message || e); res.status(500).json({ error: "lettura" }); }
  });
}
