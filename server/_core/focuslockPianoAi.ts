import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { rows } from "./focuslockRoutes";

/*
 * L'AI DEL PIANO (app 0.9.227), come Notion AI.
 *
 * Dal piano (nell'app e sul sito /piano/) si chiede all'agente di scrivere, cambiare o creare:
 *   - modo "scrivi": la barra che si apre premendo lo spazio su una riga vuota. La risposta e'
 *     SOLO il contenuto da mettere nella pagina, in markdown semplice, e arriva riga per riga;
 *   - modo "chat": la bolla in basso a destra (sul computer il pannello a destra, sul telefono
 *     il foglio dal basso). Si parla con l'agente; quando serve cambiare la pagina, l'agente
 *     scrive dei comandi su righe a parte (@@aggiungi, @@sostituisci, @@elimina, @@pagina) che il
 *     piano esegue mentre arrivano.
 *
 *   POST /api/focuslock/piano/:k/ai  { modo, domanda, pagina: { titolo, testo }, contesto?, storia? }
 *     -> text/event-stream: righe `data: {"t":"…"}` e alla fine `data: {"fine":true}`
 *   GET  /api/focuslock/piano/titolo?u=…  -> { titolo }  (il titolo di una pagina web, per i link)
 *
 * Chi puo': solo un quaderno con `premium: true` (lo scrive l'app di chi ha Premium). Limiti: 150
 * richieste al giorno per quaderno, 30 al minuto per indirizzo. Il modello: PIANO_AI_MODEL, di
 * serie Claude Haiku 4.5 (lo stesso della chat: circa un centesimo a richiesta).
 */
const CHIAVE = /^[A-Za-z0-9_-]{32,64}$/;
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
const testo = (x: unknown, max: number) => String(x ?? "").slice(0, max);

const REGOLE = [
  "Scrivi in un italiano semplice e chiaro, frasi brevi. Mai il trattino lungo, mai le virgolette caporali (usa le virgolette normali \"), mai la forma \"non e' X, e' Y\", niente frasi da poster motivazionale.",
  "Sei l'agente personale dell'utente dentro il suo piano di DreamMap, una copia di Notion: lo aiuti a scrivere, riordinare e trasformare le sue pagine in piani d'azione concreti.",
].join(" ");
const MARKDOWN = "Usa SOLO questo markdown, una riga per blocco: \"# \" titolo grande, \"## \" titolo medio, \"### \" titolo piccolo, \"- \" elenco puntato, \"1. \" elenco numerato, \"[ ] \" cosa da fare, \"> \" citazione, \"---\" divisore, altrimenti testo normale. Dentro una riga puoi usare **grassetto** e *corsivo*. Niente tabelle, niente righe vuote inutili.";
const SCRIVI = [
  REGOLE,
  "Ti chiedono di SCRIVERE NELLA PAGINA. Rispondi SOLO con il contenuto da inserire, senza premesse e senza commenti finali.",
  MARKDOWN,
].join("\n\n");
const CHAT = [
  REGOLE,
  "Rispondi alla persona in modo breve e utile (markdown semplice). Quando ti chiede di scrivere, cambiare, riordinare o creare qualcosa, NON limitarti a dirlo: fallo con questi comandi, ognuno su una riga da sola:",
  "@@aggiungi  (poi le righe da aggiungere: dopo il blocco del contesto se c'e', altrimenti in fondo alla pagina; chiudi con @@fine)",
  "@@sostituisci ID  (poi le righe che prendono il posto del blocco con quell'ID; chiudi con @@fine)",
  "@@elimina ID",
  "@@pagina EMOJI Titolo della pagina nuova  (poi il contenuto della pagina nuova; chiudi con @@fine)",
  "Gli ID sono i numeri fra parentesi quadre all'inizio delle righe della pagina. Dentro i comandi: " + MARKDOWN,
  "Prima dei comandi scrivi una frase sola su cosa stai per fare; dopo, niente.",
].join("\n");

export function registerFocusLockPianoAiRoutes(app: Express) {
  app.options("/api/focuslock/piano/:k/ai", (_req: Request, res: Response) => { cors(res); res.status(204).end(); });

  app.get("/api/focuslock/piano-titolo", async (req: Request, res: Response) => {
    cors(res);
    const u = String(req.query.u || "");
    if (!/^https?:\/\/[^\s]{3,1900}$/.test(u)) { res.status(400).json({ error: "link non valido" }); return; }
    if (troppe("pt:" + ip(req), 120, 3600000)) { res.status(429).json({ error: "troppe richieste" }); return; }
    try {
      const host = new URL(u).hostname;
      if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || host.endsWith(".internal")) { res.json({ titolo: "" }); return; }
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(u, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (DreamMap link preview)", accept: "text/html" } });
      const html = (await r.text()).slice(0, 300000); clearTimeout(t);
      const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html) || /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i.exec(html);
      const tt = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html);
      const dec = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
      res.json({ titolo: dec((og?.[1] || tt?.[1] || "")).slice(0, 140) });
    } catch { res.json({ titolo: "" }); }
  });

  app.post("/api/focuslock/piano/:k/ai", async (req: Request, res: Response) => {
    cors(res);
    const k = String(req.params.k || "");
    if (!CHIAVE.test(k)) { res.status(400).json({ error: "chiave non valida" }); return; }
    if (!process.env.AGENT_LLM_KEY) { res.status(503).json({ error: "spenta" }); return; }
    if (troppe("pai:" + ip(req), 30, 60000) || troppe("paik:" + k, 150, 86400000)) { res.status(429).json({ error: "troppe richieste" }); return; }
    try {
      const r = await rows(sql`SELECT dati FROM focuslock_piano WHERE chiave = ${k} LIMIT 1`);
      if (!r.length) { res.status(404).json({ error: "quaderno sconosciuto" }); return; }
      let premium = false; try { premium = JSON.parse(String(r[0].dati)).premium === true; } catch { premium = false; }
      if (!premium) { res.status(402).json({ error: "premium" }); return; }
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); return; }

    const b = req.body ?? {};
    const modo = b.modo === "chat" ? "chat" : "scrivi";
    const domanda = testo(b.domanda, 4000).trim();
    if (!domanda) { res.status(400).json({ error: "domanda vuota" }); return; }
    const pagina = `PAGINA: ${testo(b.pagina?.titolo, 200)}\n${testo(b.pagina?.testo, 24000)}`;
    const contesto = testo(b.contesto, 4000);
    const storia = Array.isArray(b.storia) ? b.storia.slice(-10).map((m: any) => ({ role: m?.role === "assistant" ? "assistant" as const : "user" as const, content: testo(m?.content, 4000) || "…" })) : [];
    const ultimo = `${pagina}\n\n${contesto ? "CONTESTO (il blocco o il testo scelto dall'utente):\n" + contesto + "\n\n" : ""}RICHIESTA: ${domanda}`;
    const messages = [...storia, { role: "user" as const, content: ultimo }];
    if (messages[0]?.role === "assistant") messages.shift();

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    let chiuso = false;
    const flusso = claude().messages.stream({
      model: process.env.PIANO_AI_MODEL || "claude-haiku-4-5",
      max_tokens: modo === "chat" ? 3000 : 2500,
      system: [{ type: "text", text: modo === "chat" ? CHAT : SCRIVI, cache_control: { type: "ephemeral" } }],
      messages,
    });
    req.on("close", () => { chiuso = true; try { flusso.abort(); } catch { /* gia' finito */ } });
    flusso.on("text", (t: string) => { if (!chiuso) res.write(`data: ${JSON.stringify({ t })}\n\n`); });
    try {
      await flusso.finalMessage();
      if (!chiuso) { res.write(`data: ${JSON.stringify({ fine: true })}\n\n`); res.end(); }
    } catch (e: any) {
      if (!chiuso) { res.write(`data: ${JSON.stringify({ errore: String(e?.message || e).slice(0, 200) })}\n\n`); res.end(); }
    }
  });
}
