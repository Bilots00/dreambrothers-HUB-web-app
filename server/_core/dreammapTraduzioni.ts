import type { Express, Request, Response } from "express";
import { createHash } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { rows } from "./dreammapSocial";

/* DreamMap — I TESTI IN QUALSIASI LINGUA (22/11/2026).
 *
 * Andrea: "vogliamo togliere qualsiasi frizione: se l'utente e' giapponese, rispondere in giapponese, non in inglese".
 * I testi nascono in italiano (server/_core/testi/<pacco>.it.json, estratti dall'app con tools/estrai-testi.mjs). La
 * prima volta che serve una lingua, Claude traduce il pacco e il risultato resta nel database: da li' in poi e'
 * istantaneo per tutti. Se il pacco italiano cambia, cambia la firma e si traduce di nuovo.
 *
 * Il GLOSSARIO si traduce per primo e una volta sola per lingua, e viene passato a ogni pacco: cosi' il Genio, il patto,
 * il garante, il vecchio te e il nuovo te hanno lo stesso nome dappertutto, nell'app e su Telegram.
 *
 * COSTI (gate economico): un pacco come quello del patto e' qualche migliaio di parole; con Claude Opus 5.5
 * ($4 / $20 per milione di token, platform.claude.com) sono pochi centesimi per lingua, una volta sola.
 * Le lingue accettate sono solo i codici veri (Intl.DisplayNames), quindi il costo massimo e' limitato.
 */

const DIR = join(process.cwd(), "server", "_core", "testi");
const MODELLO = process.env.TRADUZIONI_MODEL || "claude-opus-5-5";
export type Pacco = Record<string, string>;

/** "ja", "pt-BR", "zh-Hant": solo codici di lingua reali. Torna il codice pulito o "" se non vale. */
export function linguaValida(x: unknown): string {
  const s = String(x || "").trim().replace(/_/g, "-");
  const m = /^([a-zA-Z]{2,3})(?:-([A-Za-z]{4}|[A-Za-z]{2}|\d{3}))?$/.exec(s);
  if (!m) return "";
  const base = m[1].toLowerCase();
  let nome = "";
  try { nome = new Intl.DisplayNames(["en"], { type: "language" }).of(base) || ""; } catch { nome = ""; }
  if (!nome || nome.toLowerCase() === base) return "";
  const sub = m[2] ? (m[2].length === 4 ? m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() : m[2].toUpperCase()) : "";
  /* le varianti che cambiano davvero il testo; le altre si leggono con la lingua base */
  const tiene = (base === "pt" && sub === "BR") || (base === "pt" && sub === "PT") || (base === "zh" && /^(Hans|Hant|TW|HK|CN)$/.test(sub));
  return tiene ? base + "-" + sub : base;
}
/** I segnaposto {nome} di un testo, in ordine e senza doppioni. */
export function segnaposto(t: string): string {
  return Array.from(new Set((String(t).match(/\{[a-zA-Z]+\}/g) || []))).sort().join(",");
}
/** I tag HTML di un testo (<b>, </b>...), per controllare che la traduzione li tenga. */
function tag(t: string): string { return (String(t).match(/<\/?[a-z]+>/gi) || []).map((x) => x.toLowerCase()).sort().join(","); }
/** Le chiavi tradotte male (segnaposto o tag persi o inventati): si tengono le buone. */
export function controllaTraduzione(sorgente: Pacco, tradotto: Record<string, unknown>): { buone: Pacco; male: string[] } {
  const buone: Pacco = {}, male: string[] = [];
  for (const k of Object.keys(sorgente)) {
    const v = tradotto[k];
    if (typeof v === "string" && v.trim() && segnaposto(v) === segnaposto(sorgente[k]) && tag(v) === tag(sorgente[k])) buone[k] = v;
    else male.push(k);
  }
  return { buone, male };
}
export function firma(p: Pacco): string { return createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0, 16); }

/* ------------------------------------------------------------------ i pacchi italiani, dal disco */
const SORGENTI = new Map<string, Pacco>();
export function pacchi(): string[] {
  try { return readdirSync(DIR).filter((f) => f.endsWith(".it.json")).map((f) => f.replace(/\.it\.json$/, "")); } catch { return []; }
}
export function sorgente(pacco: string): Pacco | null {
  if (!/^[a-z-]{2,30}$/.test(pacco)) return null;
  if (!SORGENTI.has(pacco)) {
    try {
      const j = JSON.parse(readFileSync(join(DIR, pacco + ".it.json"), "utf8"));
      const p: Pacco = {}; for (const [k, v] of Object.entries(j)) if (!k.startsWith("_") && typeof v === "string") p[k] = v;
      SORGENTI.set(pacco, p);
    } catch { return null; }
  }
  return SORGENTI.get(pacco) || null;
}

/* ------------------------------------------------------------------ il database */
let pronto: Promise<void> | null = null;
function tabella(): Promise<void> {
  if (!pronto) pronto = rows(sql`CREATE TABLE IF NOT EXISTS dreammap_traduzioni (
      pacco VARCHAR(40) NOT NULL, lingua VARCHAR(12) NOT NULL, firma VARCHAR(16) NOT NULL,
      testi MEDIUMTEXT NOT NULL, at TIMESTAMP NULL, PRIMARY KEY (pacco, lingua, firma))`).then(() => undefined).catch((e) => { pronto = null; throw e; });
  return pronto;
}
const CACHE = new Map<string, Pacco>();
const IN_CORSO = new Map<string, Promise<Pacco>>();

/* ------------------------------------------------------------------ Claude */
let CLAUDE: Anthropic | null = null;
/** Solo per le prove: un Claude finto. */
export function _provaClaude(c: any) { CLAUDE = c; CACHE.clear(); }
function claude(): Anthropic | null {
  if (CLAUDE) return CLAUDE;
  const k = process.env.AGENT_LLM_KEY || process.env.ANTHROPIC_API_KEY;
  if (!k) return null;
  if (!CLAUDE) CLAUDE = new Anthropic({ apiKey: String(k) });
  return CLAUDE;
}
const ISTRUZIONI = [
  "You translate the user interface of DreamMap, a mobile app for self-discipline and habits, from Italian into the target language.",
  "Write like a native speaker of the target language who designs apps: short, warm, direct, second person singular (informal). Never literal, never stiff.",
  "Keep every placeholder in curly braces exactly as it is, e.g. {chi}, {euro}, {data}: never translate, rename, add or drop one.",
  "Keep every HTML tag (<b>, </b>, <i>, </i>) around the matching words.",
  "Avoid assuming the gender of the people named by placeholders: when the language forces a gender, rephrase so it doesn't.",
  "DreamMap is a brand: never translate it. 'Dreambrother' is a brand word: keep it.",
  "Use the glossary terms exactly, in the correct grammatical form, every time the concept appears.",
  "Return every key of the input, with the same keys.",
].join("\n");
const GLOSSARIO_IT: Pacco = {
  genio: "il Genio",
  genioDi: "il Genio di DreamMap",
  patto: "il patto",
  garante: "il garante",
  vecchioTe: "il vecchio te",
  nuovoTe: "il nuovo te",
  contratto: "il contratto di abitudine",
  sgarro: "lo sgarro",
  penitenza: "la penitenza",
};
const NOTE_GLOSSARIO = [
  "This is a GLOSSARY of recurring terms. Choose the single best term for each, to be reused everywhere in the app.",
  "genio / genioDi: the app's guide character, a magic genie of the lamp who talks to the user and referees pacts between friends. Use the word a native speaker naturally uses for a lamp genie in this language (not an English loanword unless that IS the natural word).",
  "patto: a pact/commitment between two friends. garante: the friend who referees and receives the money if the other slips (a guarantor/witness, friendly tone).",
  "vecchioTe / nuovoTe: 'the old you' and 'the new you', the two sides of a scoreboard in the app.",
  "sgarro: a slip, breaking your own rule. penitenza: a self-chosen penalty.",
].join("\n");

/* 23/11/2026: su Railway c'e' la chiave Gemini che usa gia' il Genio, non quella di Claude. Si usa Claude se c'e' la sua
   chiave, altrimenti Gemini: cosi' le traduzioni partono senza aggiungere niente. */
function chiaveGemini(): string { return String(process.env.AGENT_GEMINI_KEY || process.env.DREAMMAP_GEMINI_KEY || process.env.GEMINI_API_KEY || ""); }
export function traduzioniAccese(): boolean { return !!(claude() || chiaveGemini()); }
async function chiediGemini(testo: string): Promise<Record<string, unknown>> {
  const modelli = [process.env.TRADUZIONI_GEMINI_MODEL || "gemini-3-flash-preview", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite-preview"].filter((x, i, a) => a.indexOf(x) === i);
  let errore: unknown = null;
  for (const modello of modelli) {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 120000);
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modello}:generateContent`, {
        method: "POST", signal: ac.signal,
        headers: { "x-goog-api-key": chiaveGemini(), "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: ISTRUZIONI + "\nAnswer with ONE JSON object only, no prose, no code fences." }] },
          contents: [{ role: "user", parts: [{ text: testo }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 32000 },
        }),
      });
      const j: any = await r.json();
      const out = (j?.candidates?.[0]?.content?.parts || []).filter((p: any) => !p.thought).map((p: any) => p.text || "").join("").trim();
      if (!r.ok || !out) throw new Error("gemini " + r.status + " " + JSON.stringify(j?.error || "").slice(0, 160));
      return JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch (e) { errore = e; } finally { clearTimeout(timer); }
  }
  throw errore || new Error("gemini: nessun modello ha risposto");
}
async function chiedi(lingua: string, sorg: Pacco, glossario: Pacco | null, note: string): Promise<Record<string, unknown>> {
  const c = claude();
  if (!c && !chiaveGemini()) throw new Error("traduzioni spente: manca la chiave di Claude o di Gemini");
  const nomeLingua = (() => { try { return new Intl.DisplayNames(["en"], { type: "language" }).of(lingua) || lingua; } catch { return lingua; } })();
  const schema = z.object(Object.fromEntries(Object.keys(sorg).map((k) => [k, z.string()])) as Record<string, z.ZodString>);
  const testo = [
    `Target language: ${nomeLingua} (${lingua}).`,
    note,
    glossario ? "Glossary (already in the target language, use these terms):\n" + JSON.stringify(glossario, null, 1) : "",
    "Italian source, as JSON:",
    JSON.stringify(sorg, null, 1),
  ].filter(Boolean).join("\n\n");
  if (!c) return chiediGemini(testo);
  const stream = c.beta.messages.stream({
    model: MODELLO,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: ISTRUZIONI,
    output_config: { format: betaZodOutputFormat(schema) },
    messages: [{ role: "user", content: testo }],
  });
  const r: any = await stream.finalMessage();
  if (r.stop_reason === "refusal") throw new Error("traduzione rifiutata");
  const t = (r.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  return JSON.parse(t);
}

async function leggi(pacco: string, lingua: string, f: string): Promise<Pacco | null> {
  const k = pacco + "|" + lingua + "|" + f;
  if (CACHE.has(k)) return CACHE.get(k)!;
  try {
    await tabella();
    const r = await rows(sql`SELECT testi FROM dreammap_traduzioni WHERE pacco = ${pacco} AND lingua = ${lingua} AND firma = ${f} LIMIT 1`);
    if (r.length) { const p = JSON.parse(String(r[0].testi)); CACHE.set(k, p); return p; }
  } catch { /* senza database si traduce e si tiene in memoria */ }
  return null;
}
async function scrivi(pacco: string, lingua: string, f: string, p: Pacco) {
  CACHE.set(pacco + "|" + lingua + "|" + f, p);
  try { await tabella(); await rows(sql`INSERT IGNORE INTO dreammap_traduzioni (pacco, lingua, firma, testi, at) VALUES (${pacco}, ${lingua}, ${f}, ${JSON.stringify(p)}, NOW())`); } catch { /* resta in memoria */ }
}

/** Il glossario nella lingua: si traduce una volta sola, e tiene fissi i nomi per tutti i pacchi. */
async function glossario(lingua: string): Promise<Pacco> {
  return traduciCon("_glossario", GLOSSARIO_IT, lingua, null, NOTE_GLOSSARIO);
}
async function traduciCon(pacco: string, sorg: Pacco, lingua: string, gloss: Pacco | null, note: string): Promise<Pacco> {
  if (lingua === "it") return sorg;
  const f = firma(sorg);
  const gia = await leggi(pacco, lingua, f); if (gia) return gia;
  const chiave = pacco + "|" + lingua + "|" + f;
  if (IN_CORSO.has(chiave)) return IN_CORSO.get(chiave)!;
  const lavoro = (async () => {
    /* a gruppi di 80 frasi: lo schema della risposta resta piccolo e una frase rotta non fa rifare tutto */
    const chiavi = Object.keys(sorg), GRUPPO = 80;
    let buone: Pacco = {}, male: string[] = [];
    for (let i = 0; i < chiavi.length; i += GRUPPO) {
      const pezzo: Pacco = {}; for (const k of chiavi.slice(i, i + GRUPPO)) pezzo[k] = sorg[k];
      const r = controllaTraduzione(pezzo, await chiedi(lingua, pezzo, gloss, note));
      buone = { ...buone, ...r.buone }; male = male.concat(r.male);
    }
    if (male.length) {
      /* un secondo giro solo per le frasi venute male */
      const resto: Pacco = {}; for (const k of male) resto[k] = sorg[k];
      const r2 = controllaTraduzione(resto, await chiedi(lingua, resto, gloss, note));
      buone = { ...buone, ...r2.buone }; male = r2.male;
    }
    if (male.length) throw new Error("traduzione incompleta: " + male.slice(0, 5).join(", "));
    await scrivi(pacco, lingua, f, buone);
    return buone;
  })();
  IN_CORSO.set(chiave, lavoro);
  try { return await lavoro; } finally { IN_CORSO.delete(chiave); }
}

/** Un pacco nella lingua chiesta. Italiano: il sorgente. Una lingua nuova: si traduce (una volta sola). */
export async function traduci(pacco: string, lingua: string): Promise<{ lingua: string; firma: string; testi: Pacco }> {
  const sorg = sorgente(pacco); if (!sorg) throw new Error("pacco sconosciuto");
  const l = linguaValida(lingua) || "en";
  if (l === "it") return { lingua: l, firma: firma(sorg), testi: sorg };
  const g = await glossario(l);
  const testi = await traduciCon(pacco, sorg, l, g, "Context: these strings belong to the '" + pacco + "' part of the app.");
  return { lingua: l, firma: firma(sorg), testi };
}
/** Un testo di un pacco nella lingua, con i segnaposto riempiti. Se la traduzione non e' possibile, l'italiano. */
export async function testoIn(pacco: string, lingua: string, chiave: string, v: Record<string, string> = {}): Promise<string> {
  let t = "";
  try { t = (await traduci(pacco, lingua)).testi[chiave] || ""; } catch { t = ""; }
  if (!t) t = (sorgente(pacco) || {})[chiave] || "";
  return t.replace(/\{([a-zA-Z]+)\}/g, (m, k) => (k in v ? v[k] : m));
}

export function registerDreamMapTraduzioniRoutes(app: Express) {
  /* GET /api/focuslock/testi/<pacco>?lingua=ja -> { lingua, firma, testi }. Pubblico: sono i testi dell'interfaccia. */
  app.get("/api/focuslock/testi/:pacco", async (req: Request, res: Response) => {
    const pacco = String(req.params.pacco || "");
    if (!sorgente(pacco)) { res.status(404).json({ error: "pacco sconosciuto" }); return; }
    const l = linguaValida(req.query.lingua);
    if (!l) { res.status(400).json({ error: "lingua non valida" }); return; }
    try {
      const r = await traduci(pacco, l);
      res.set("cache-control", "public, max-age=3600").json(r);
    } catch (e: any) { res.status(503).json({ error: String(e?.message || e) }); }
  });
}
