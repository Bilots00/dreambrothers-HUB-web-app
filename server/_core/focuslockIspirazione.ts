import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { rows } from "./focuslockRoutes";

/*
 * LIBRI E FILM PER IL TUO VIAGGIO, SCELTI DAL TUO AGENTE (app 0.9.354)
 *
 * Nella pagina "La tua storia" la persona sceglie ogni quanto ricevere un libro o un film (a stagione, al mese, alla
 * settimana). Senza Premium il titolo lo sceglie il Genio dal catalogo dell'app (content/episodi.json, ispirazione).
 * Con Premium lo sceglie il suo agente personale, su misura: il sogno, la tappa di oggi, il collo di bottiglia, l'Io
 * Futuro, e una riga sul perche' quel titolo serve proprio a lui adesso.
 *
 * E' una richiesta di servizio dell'app, non un messaggio della chat: non passa dalla coda dell'agente e non compare
 * nella conversazione. L'app la manda quando scatta la cadenza; se questa rotta non risponde, o risponde male, l'app
 * usa il catalogo e non mostra nessun errore.
 *
 *   POST /api/focuslock/piano/:k/ispirazione
 *     { cadenza, sogno, tipoSogno, tappa, collo, ioFuturo, dati: ["titoli gia' dati"], esempi: ["titoli del catalogo"] }
 *     -> { ok: true, opera: { tipo, t, autore, anno, perche, chi, tema, curiosita }, modello } | { ok: false }
 *
 * Chi puo': come l'AI del piano (focuslockPianoAi.ts), solo un quaderno con `premium: true` sotto la chiave privata del
 * piano. Niente crediti: e' un titolo per periodo, compreso in Premium. Limiti: 4 richieste al giorno per quaderno, 20
 * all'ora per indirizzo. Nessuna scrittura nel database: si legge solo il quaderno.
 *
 * SOLO OPERE VERE. Il modello deve dare titolo italiano, autore o regista e anno giusti, e la pagina di Wikipedia;
 * prima di rispondere il server controlla su Wikipedia che la pagina esista e parli di quell'autore o di quell'anno.
 * Se non torna, risponde { ok: false } e l'app usa il catalogo.
 */
const CHIAVE = /^[A-Za-z0-9_-]{32,64}$/;
const TEMI = ["rinascita", "talento", "ribellione", "amore", "ingegno", "spirito", "liberta"];
let CLAUDE: Anthropic | null = null;
function claude(): Anthropic {
  if (!CLAUDE) CLAUDE = new Anthropic({ apiKey: String(process.env.AGENT_LLM_KEY) });
  return CLAUDE;
}
const finestre = new Map<string, number[]>();
function troppe(k: string, max: number, ms: number): boolean {
  const ora = Date.now();
  const v = (finestre.get(k) || []).filter((t) => ora - t < ms);
  if (v.length >= max) { finestre.set(k, v); return true; }
  v.push(ora); finestre.set(k, v);
  if (finestre.size > 20000) finestre.clear();
  return false;
}
function ip(req: Request): string { return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim().slice(0, 64); }
function cors(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}
const testo = (x: unknown, max: number) => String(x ?? "").replace(/\u0000/g, "").trim().slice(0, max);
/** Il copy che il modello sbaglia non arriva a schermo: virgolette normali, niente trattini lunghi, niente due punti in mezzo alla riga. */
function copy(x: unknown, max: number): string {
  return String(x ?? "").replace(/[«»“”]/g, "\"").replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, max);
}
/** Le frasi (il perche', la curiosita'): in piu', i due punti in mezzo alla riga diventano un punto. */
function frase(x: unknown, max: number): string {
  const s = copy(x, max + 40).replace(/\s*:\s+(\S)/g, (_m, c: string) => ". " + c.toUpperCase());
  return s.slice(0, max);
}
function norma(s: unknown): string {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tipo: { type: "string", enum: ["film", "libro"] },
    t: { type: "string", description: "Il titolo con cui l'opera e' uscita in Italia" },
    originale: { type: "string", description: "Il titolo originale, se e' diverso; altrimenti vuoto" },
    autore: { type: "string", description: "Il regista (film) o l'autore (libro), nome e cognome" },
    anno: { type: "string", description: "L'anno di uscita, solo il numero (per le opere antiche il secolo, per esempio XV secolo)" },
    wiki: { type: "string", description: "La pagina di Wikipedia: it:Titolo se esiste in italiano, altrimenti en:Title" },
    perche: { type: "string", description: "Una riga sola (massimo 140 caratteri) che lega il titolo al suo sogno o alla tappa di oggi" },
    chi: { type: "string", description: "Il protagonista, o l'autore per i saggi" },
    tema: { type: "string", enum: TEMI },
    curiosita: { type: "string", description: "Una curiosita' vera e nota sull'opera, una o due frasi; vuoto se non sei sicuro" },
  },
  required: ["tipo", "t", "originale", "autore", "anno", "wiki", "perche", "chi", "tema", "curiosita"],
};
const ISTRUZIONI = [
  "Sei l'agente personale di una persona dentro DreamMap, l'app italiana che porta dal sogno alla destinazione un passo alla volta.",
  "Le consigli UN libro o UN film per il suo viaggio: un premio che la ispira, non un compito. Lo sceglie su misura per lei: il suo sogno, la tappa di oggi, il collo di bottiglia che la frena, chi vuole diventare (l'Io Futuro).",
  "SOLO OPERE CHE ESISTONO DAVVERO e che si trovano in Italia: il titolo italiano con cui sono uscite, il regista o l'autore giusto, l'anno giusto, la pagina di Wikipedia. Se non sei sicuro di un dato, scegli un'altra opera di cui sei sicuro. Mai inventare.",
  "Mai un titolo della lista \"gia' dati\". Preferisci opere famose e facili da trovare, adatte a tutti, che raccontano qualcuno che costruisce, insiste, ricomincia o cambia.",
  "\"perche\": una riga sola, con il tu, che dice perché proprio adesso, legata al suo sogno, alla tappa di oggi o a quello che la frena. Per esempio \"Ti blocchi sulla prima vendita, e qui un uomo vende porta a porta finché ce la fa.\"",
  "Come scrivi. Italiano semplice, frasi brevi, accenti veri (è, perché, più). Virgolette solo \"\", mai le caporali. Mai il trattino lungo. Mai i due punti in mezzo alla frase. Mai la forma \"non è X, è Y\". Niente frasi da poster motivazionale.",
  "\"curiosita\": un fatto vero e controllabile sull'opera (come e' nata, una storia vera dietro, un premio), una o due frasi. Se non ne conosci uno sicuro, lascia vuoto.",
].join("\n");

async function chiedi(b: any): Promise<{ op: any; modello: string } | null> {
  const dati = (Array.isArray(b.dati) ? b.dati : []).slice(0, 80).map((x: any) => testo(x, 120)).filter(Boolean);
  const esempi = (Array.isArray(b.esempi) ? b.esempi : []).slice(0, 30).map((x: any) => testo(x, 120)).filter(Boolean);
  const cad = ["stagione", "mese", "settimana"].includes(String(b.cadenza)) ? String(b.cadenza) : "mese";
  const domanda = [
    "IL SUO SOGNO: " + (testo(b.sogno, 300) || "(non l'ha ancora scritto)"),
    b.tipoSogno ? "IL TIPO DI SOGNO: " + testo(b.tipoSogno, 40) : "",
    b.tappa ? "LA TAPPA DI OGGI SULLA MAPPA: " + testo(b.tappa, 200) : "",
    b.collo ? "IL COLLO DI BOTTIGLIA (cosa lo frena): " + testo(b.collo, 300) : "",
    b.ioFuturo ? "IL SUO IO FUTURO (chi vuole diventare):\n" + testo(b.ioFuturo, 1500) : "",
    "OGNI QUANTO RICEVE UN TITOLO: una volta " + (cad === "stagione" ? "a stagione" : cad === "mese" ? "al mese" : "alla settimana"),
    "GIA' DATI (mai di nuovo): " + (dati.length ? dati.join("; ") : "nessuno"),
    esempi.length ? "IL GENERE DI TITOLI DEL CATALOGO DELL'APP, come esempio: " + esempi.join("; ") : "",
  ].filter(Boolean).join("\n");
  const modello = process.env.DREAMMAP_ISPIRAZIONE_MODEL || process.env.GENIO_MODEL || "claude-opus-5-5";
  /* come le altre richieste brevi del Genio: ragionamento basso, formato imposto dallo schema, e se un classificatore
   * declina la richiesta riparte sul modello che Anthropic indica (fallbacks "default") */
  const r: any = await (claude().beta.messages.create as any)({
    model: modello,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: ISTRUZIONI,
    messages: [{ role: "user", content: domanda }],
  });
  if (!r || r.stop_reason === "refusal" || r.stop_reason === "max_tokens") return null;
  const t = (r.content || []).filter((x: any) => x.type === "text").map((x: any) => x.text).join("").trim();
  let j: any = null; try { j = JSON.parse(t); } catch { return null; }
  if (!j || (j.tipo !== "film" && j.tipo !== "libro")) return null;
  const op = {
    tipo: j.tipo as "film" | "libro",
    t: copy(j.t, 120), originale: testo(j.originale, 120), autore: copy(j.autore, 80), anno: copy(j.anno, 20), wiki: testo(j.wiki, 200),
    perche: frase(j.perche, 160), chi: copy(j.chi, 60), tema: TEMI.includes(String(j.tema)) ? String(j.tema) : "rinascita", curiosita: frase(j.curiosita, 260),
  };
  if (!op.t || !op.autore || !op.anno || !op.perche) return null;
  if (dati.some((x: string) => norma(x) === norma(op.t))) return null;
  return { op, modello: String(r.model || modello) };
}

/* ---------------------------------------------------------------------------------------
 * WIKIPEDIA: la pagina esiste e parla di quell'autore o di quell'anno
 * --------------------------------------------------------------------------------------- */
const UA = { "User-Agent": "DreamMap-Ispirazione/1.0" };
async function prendi(url: string): Promise<any | null> {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 4000);
  try { const r = await fetch(url, { headers: UA, signal: ctl.signal }); return r.ok ? await r.json() : null; }
  catch { return null; } finally { clearTimeout(tm); }
}
async function riassunto(lingua: string, titolo: string): Promise<any | null> {
  const j = await prendi(`https://${lingua}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titolo.replace(/ /g, "_"))}`);
  return j && j.type !== "disambiguation" && j.title ? j : null;
}
async function cerca(lingua: string, q: string): Promise<string | null> {
  const j = await prendi(`https://${lingua}.wikipedia.org/w/api.php?action=opensearch&limit=1&namespace=0&format=json&search=${encodeURIComponent(q)}`);
  return j && j[1] && j[1][0] ? String(j[1][0]) : null;
}
/** Vero se una pagina di Wikipedia racconta proprio quest'opera: il titolo somiglia, e il testo nomina l'autore o l'anno. */
async function vera(op: { t: string; originale: string; autore: string; anno: string; wiki: string }): Promise<boolean> {
  const cognome = norma(op.autore).split(" ").filter((x) => x.length > 2).pop() || "";
  const anno = (/\d{4}/.exec(op.anno) || [""])[0];
  const titoli = [op.t, op.originale].map(norma).filter(Boolean);
  const somiglia = (x: string) => { const n = norma(x); return titoli.some((t) => n.includes(t) || t.includes(n)); };
  const parla = (j: any) => { const e = norma((j.extract || "") + " " + (j.description || "")); return (!!cognome && e.includes(cognome)) || (!!anno && e.includes(anno)); };
  const prove: [string, string][] = [];
  const m = /^(it|en):(.+)$/.exec(op.wiki);
  if (m) prove.push([m[1], m[2]]);
  for (const [lingua, q] of [["it", op.t], ["en", op.originale || op.t]] as [string, string][]) {
    const t = await cerca(lingua, q);
    if (t) prove.push([lingua, t]);
  }
  for (const [lingua, titolo] of prove) {
    if (!somiglia(titolo)) continue;
    const j = await riassunto(lingua, titolo);
    if (j && parla(j)) return true;
  }
  return false;
}

export function registerFocusLockIspirazioneRoutes(app: Express) {
  app.options("/api/focuslock/piano/:k/ispirazione", (_req: Request, res: Response) => { cors(res); res.status(204).end(); });

  app.post("/api/focuslock/piano/:k/ispirazione", async (req: Request, res: Response) => {
    cors(res);
    const k = String(req.params.k || "");
    if (!CHIAVE.test(k)) { res.status(400).json({ ok: false, error: "chiave non valida" }); return; }
    if (!process.env.AGENT_LLM_KEY) { res.status(503).json({ ok: false, error: "spenta" }); return; }
    if (troppe("isp:" + ip(req), 20, 3600000) || troppe("ispk:" + k, 4, 86400000)) { res.status(429).json({ ok: false, error: "troppe richieste" }); return; }
    try {
      const r = await rows(sql`SELECT dati FROM focuslock_piano WHERE chiave = ${k} LIMIT 1`);
      if (!r.length) { res.status(404).json({ ok: false, error: "quaderno sconosciuto" }); return; }
      let premium = false; try { premium = JSON.parse(String(r[0].dati)).premium === true; } catch { premium = false; }
      if (!premium) { res.status(402).json({ ok: false, error: "premium" }); return; }
    } catch (e: any) { res.status(500).json({ ok: false, error: "db: " + (e?.message || String(e)) }); return; }
    try {
      /* due tentativi: se il primo titolo non si trova su Wikipedia, il secondo lo esclude */
      const b = req.body ?? {};
      const dati = (Array.isArray(b.dati) ? b.dati : []).slice(0, 80);
      for (let giro = 0; giro < 2; giro++) {
        const x = await chiedi({ ...b, dati });
        if (!x) continue;
        if (!(await vera(x.op))) { console.warn("[ispirazione] non verificato:", x.op.t, x.op.autore, x.op.anno); dati.push(x.op.t); continue; }
        const { originale, wiki, ...opera } = x.op;
        res.json({ ok: true, opera, modello: x.modello });
        return;
      }
      res.json({ ok: false });
    } catch (e: any) {
      console.error("[ispirazione]", e?.message || e);
      res.json({ ok: false });
    }
  });
}
/* per la prova in locale del controllo su Wikipedia (nessuna rotta la usa da fuori) */
export { vera as ispirazioneVera };
