import type { Express, Request, Response } from "express";
import { whoIs, isIdentity } from "./dreammapRoutes";

/* DreamMap 0.9.290 — LA DETTATURA CON UN MODELLO CHE ASCOLTA DAVVERO (come Wispr Flow).
 *
 * Andrea: "la trascrizione vocale fa cagare: non usa l'AI, capisce male le parole e si mangia pezzi all'inizio e alla
 * fine". Il riconoscitore del telefono ascolta a pezzi e indovina parola per parola. Con gli Appunti AI accesi l'app
 * adesso REGISTRA la voce intera e la manda qui; il server la passa a ElevenLabs Scribe v2, che ascolta tutto
 * l'audio, mette la punteggiatura e (no_verbatim) toglie "ehm", false partenze e rumori.
 *
 * IL CONTO (listino ElevenLabs, ottobre 2026, elevenlabs.io/pricing/api): Scribe v2 costa 0,22 $ l'ora (0,0037 $ al
 * minuto). Il piano Starter gia' attivo su questa chiave (ELEVENLABS_API_KEY, la stessa della chiamata con l'Io
 * futuro) comprende 27 ore al mese, sugli stessi crediti della voce. Il tetto qui sotto (di serie 60 minuti al giorno
 * per persona) protegge quei crediti; finiti i minuti o i crediti, l'app torna da sola al riconoscitore del telefono.
 */

/* 0.9.293, Andrea: "preferisco Gemini a ElevenLabs, oppure quella che costa meno". IL CONFRONTO (listini ufficiali letti il
 * 21/10/2026): Gemini conta l'audio a 32 token al secondo, 115.200 token l'ora. Con 2.5 Flash-Lite (0,30 $ per milione
 * in ingresso, 0,40 $ in uscita) un'ora costa circa 0,04 $; Scribe v2 0,22 $; gpt-4o-mini-transcribe 0,18 $. Con 60
 * minuti al giorno per persona: circa 1,20 $ al mese con Gemini contro 6,60 $ con Scribe. Gemini fa trascrizione,
 * punteggiatura e pulizia in una chiamata sola. Il piano gratuito di Gemini NON si puo' usare per utenti europei (termini
 * Google: "only Paid Services ... in the European Economic Area"), quindi la chiave deve stare su un progetto con la
 * fatturazione attiva. Ordine: Gemini se c'e' la chiave, altrimenti (o se Gemini fallisce) Scribe. */
const GEMINI_CHIAVE = () => process.env.DREAMMAP_GEMINI_KEY || process.env.AGENT_GEMINI_KEY || process.env.GEMINI_API_KEY || "";
const GEMINI_MODELLO = () => process.env.DREAMMAP_DETTATURA_MODELLO || "gemini-3.5-flash-lite";
const ISTRUZIONI = "Trascrivi l'audio parola per parola, nella lingua in cui si parla (di solito italiano). Metti punteggiatura e maiuscole giuste. Togli solo le esitazioni (ehm, uhm), le false partenze e le parole ripetute due volte di fila. Non riassumere, non tradurre, non aggiungere niente, nessun commento e nessun titolo. Se nell'audio non si parla, rispondi con una stringa vuota.";
async function conGemini(buf: Buffer, mime: string, parole: string[] = []): Promise<{ testo: string; modello: string }> {
  const chiave = GEMINI_CHIAVE();
  if (!chiave) throw new Error("nessuna chiave Gemini");
  const modello = GEMINI_MODELLO();
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modello}:generateContent`, {
    method: "POST", headers: { "x-goog-api-key": chiave, "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: ISTRUZIONI }] },
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime.split(";")[0] || "audio/webm", data: buf.toString("base64") } }, { text: "Trascrivi tutto l'audio fino all'ultima parola." + (parole.length ? " Parole che possono comparire, scritte cosi': " + parole.join(", ") + "." : "") }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: "minimal" } },
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("gemini " + r.status + " " + JSON.stringify(j?.error?.message || "").slice(0, 160));
  const testo = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
  return { testo, modello };
}

const MAX_SEC_GIORNO = Math.max(60, Math.floor(Number(process.env.FOCUSLOCK_DETTATURA_MIN_GIORNO || 60) * 60));
const MAX_BYTE = 25 * 1024 * 1024;
const USATI = new Map<string, { giorno: string; sec: number }>();
function giorno(): string { return new Date().toISOString().slice(0, 10); }

/* 0.9.342, Andrea: "la trascrizione con l'AI fa cagare: si mangia le ultime parole e capisce 'toma' per 'Roma'; la dettatura del
 * telefono e' meglio". Abbiamo guardato come lavora Wispr Flow (l'app installata sul PC): manda TUTTO l'audio a un riconoscitore vero
 * (/llm/asr) con la lingua scelta e un dizionario (nome, parole del testo, vocabolario personale), e dopo il rilascio tiene il
 * microfono acceso finche' la voce non tace. Gemini Flash-Lite e' un modello di linguaggio che ascolta: riassume, salta la coda e
 * inventa parole simili. Adesso l'ordine e' il contrario: prima ElevenLabs Scribe v2 (un riconoscitore vero, con i "keyterms", le parole
 * da riconoscere), poi Gemini solo se Scribe non risponde. Il conto: Scribe 0,22 $ l'ora, +20% con i keyterms (0,26 $), sul piano
 * Starter gia' attivo (27 ore al mese); con piu' di 100 keyterms ogni richiesta conta almeno 20 secondi, quindi se ne mandano al
 * massimo 60. */
function paroleChiave(v: any): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const w = String(x || "").replace(/[<>{}\[\]\\]/g, "").replace(/\s+/g, " ").trim();
    if (w.length < 2 || w.length > 50 || w.split(" ").length > 5) continue;
    if (!out.includes(w)) out.push(w);
    if (out.length >= 90) break;
  }
  return out;
}
async function conScribe(chiave: string, buf: Buffer, mime: string, lingua: string, parole: string[]): Promise<{ ok: boolean; status: number; j: any }> {
  const prova = async (conParole: boolean) => {
    const fd = new FormData();
    fd.append("model_id", "scribe_v2");
    fd.append("language_code", lingua);
    fd.append("no_verbatim", "true");
    fd.append("tag_audio_events", "false");
    fd.append("timestamps_granularity", "none");
    if (conParole) for (const p of parole) fd.append("keyterms", p);
    const est = /mp4|m4a|aac/.test(mime) ? "m4a" : (/ogg/.test(mime) ? "ogg" : (/wav/.test(mime) ? "wav" : "webm"));
    fd.append("file", new Blob([new Uint8Array(buf)], { type: mime }), "dettato." + est);
    const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": chiave }, body: fd });
    const j: any = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  };
  let r = await prova(parole.length > 0);
  /* se le parole chiave non vanno bene (formato o piano), si riprova senza: la trascrizione conta piu' del dizionario */
  if (!r.ok && parole.length && (r.status === 400 || r.status === 422)) {
    console.warn("[trascrivi] Scribe con keyterms rifiutato, riprovo senza:", JSON.stringify(r.j?.detail || r.j).slice(0, 200));
    r = await prova(false);
  }
  return r;
}

/* 0.9.363, Andrea: "in macchina ho detto 'usare lo slider counter al posto dei dots nav se ci sono gia' i dots nav in uno slider
 * carousel' e mi ha scritto 'Rider al posto dei Dodge Snow quando ci sono gia' Idol Snav'. Wispr Flow e Claude non sbagliano le parole
 * inglesi dentro una frase italiana, neanche con il rumore". Come lavorano: il riconoscitore sente i suoni, poi un modello di linguaggio
 * rilegge la frase con il contesto (quello che stai scrivendo, il tuo vocabolario, i termini del tuo lavoro) e rimette le parole giuste.
 * Qui lo stesso: dopo Scribe, una rilettura che corregge SOLO le parole sentite male, usando il testo gia' scritto nel campo e il
 * glossario. Se la correzione cambia troppo la frase (piu' del 35% della lunghezza) o non risponde in 5 secondi, resta la frase di Scribe.
 * Il conto: una rilettura sono poche centinaia di token, meno di un decimo di centesimo con Gemini Flash-Lite o Claude Haiku. */
const RILEGGI = "Sei il correttore di una dettatura vocale. Ricevi la trascrizione automatica di una frase detta a voce, spesso in italiano con parole inglesi o tecniche in mezzo, a volte registrata in auto con rumore. Correggi SOLO le parole riconosciute male: termini inglesi trascritti come parole italiane o nomi strani (es. 'Dodge Snow' = 'dots nav', 'Rider' = 'slider'), nomi propri, termini tecnici. Usa il glossario e il testo gia' scritto per capire cosa voleva dire. Non riscrivere lo stile, non riassumere, non aggiungere niente, non tradurre: tieni la stessa lingua e le stesse parole giuste. Se una parola e' gia' corretta o non sei sicuro, lasciala com'e'. Rispondi solo con la frase corretta, senza virgolette e senza spiegazioni.";
async function rileggi(testo: string, contesto: string, parole: string[]): Promise<{ testo: string; da: string } | null> {
  const prompt = "GLOSSARIO: " + parole.join(", ") + "\n\nTESTO GIA' SCRITTO NEL CAMPO (contesto): " + (contesto || "(vuoto)") + "\n\nTRASCRIZIONE DA CORREGGERE: " + testo;
  const entro = <T,>(p: Promise<T>) => Promise.race([p, new Promise<null>((ok) => setTimeout(() => ok(null), 5000))]);
  const g = GEMINI_CHIAVE();
  if (g) {
    try {
      const r: any = await entro(fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.DREAMMAP_RILEGGI_MODELLO || "gemini-3.5-flash-lite"}:generateContent`, {
        method: "POST", headers: { "x-goog-api-key": g, "content-type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: RILEGGI }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 1500, thinkingConfig: { thinkingLevel: "minimal" } } }),
      }));
      if (r && r.ok) { const j: any = await r.json().catch(() => ({})); const t = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim(); if (t) return { testo: t, da: "gemini" }; }
    } catch { /* si prova il prossimo */ }
  }
  const a = process.env.ANTHROPIC_API_KEY;
  if (a) {
    try {
      const r: any = await entro(fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "x-api-key": a, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: process.env.DREAMMAP_RILEGGI_CLAUDE || "claude-haiku-5-5", max_tokens: 1500, temperature: 0, system: RILEGGI, messages: [{ role: "user", content: prompt }] }),
      }));
      if (r && r.ok) { const j: any = await r.json().catch(() => ({})); const t = (j?.content || []).map((p: any) => p.text || "").join("").trim(); if (t) return { testo: t, da: "claude" }; }
    } catch { /* resta Scribe */ }
  }
  return null;
}
async function rileggiSicuro(testo: string, contesto: string, parole: string[]): Promise<{ testo: string; riletto: string }> {
  if (!testo || testo.length < 3) return { testo, riletto: "" };
  const r = await rileggi(testo, contesto, parole).catch(() => null);
  if (!r) return { testo, riletto: "" };
  const t = r.testo.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (!t || Math.abs(t.length - testo.length) > Math.max(12, testo.length * 0.35)) return { testo, riletto: "" };
  return { testo: t, riletto: r.da };
}

export function registerDreamMapTrascriviRoutes(app: Express) {
  app.post("/api/focuslock/agent/trascrivi", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    const chiave = process.env.ELEVENLABS_API_KEY;
    if (!chiave && !GEMINI_CHIAVE()) { res.status(503).json({ error: "trascrizione spenta", spenta: true }); return; }
    const body = req.body || {};
    const b64 = String(body.audio || "");
    const mime = String(body.mime || "audio/webm").slice(0, 60);
    const durata = Math.max(0, Math.min(1800, Number(body.durata) || 0));
    if (!b64) { res.status(400).json({ error: "audio is required" }); return; }
    const buf = Buffer.from(b64, "base64");
    if (!buf.length || buf.length > MAX_BYTE) { res.status(413).json({ error: "audio troppo lungo" }); return; }
    const u = USATI.get(who.sub);
    const oggi = giorno();
    const usati = u && u.giorno === oggi ? u.sec : 0;
    if (usati + durata > MAX_SEC_GIORNO) { res.status(429).json({ error: "minuti di oggi finiti", finiti: true }); return; }
    const lingua = String(body.lingua || "it").slice(0, 5);
    const parole = paroleChiave(body.parole);
    const contesto = String(body.contesto || "").replace(/\s+/g, " ").slice(-600);
    let erroreScribe = "";
    if (chiave) {
      try {
        const r = await conScribe(String(chiave), buf, mime, lingua, parole);
        if (r.ok) {
          const sec = Math.round(Number(r.j?.audio_duration_secs) || durata || 0);
          USATI.set(who.sub, { giorno: oggi, sec: usati + sec });
          const rl = await rileggiSicuro(String(r.j?.text || "").trim(), contesto, parole);
          res.json({ testo: rl.testo, sec, lingua: r.j?.language_code || "", motore: "scribe_v2" + (parole.length ? "+keyterms" : "") + (rl.riletto ? "+riletto-" + rl.riletto : "") });
          return;
        }
        erroreScribe = String(r.j?.detail?.message || r.j?.detail?.status || r.j?.detail || r.status);
        if (!GEMINI_CHIAVE()) {
          res.status(r.status === 401 || r.status === 402 || /quota|credit/i.test(erroreScribe) ? 402 : 502).json({ error: "trascrizione non riuscita: " + erroreScribe.slice(0, 200) });
          return;
        }
        console.warn("[trascrivi] Scribe non riuscito, provo Gemini:", erroreScribe.slice(0, 200));
      } catch (e: any) {
        erroreScribe = e?.message || String(e);
        if (!GEMINI_CHIAVE()) { res.status(502).json({ error: "trascrizione non riuscita: " + erroreScribe }); return; }
      }
    }
    if (GEMINI_CHIAVE()) {
      try {
        const g = await conGemini(buf, mime, parole);
        const sec = Math.round(durata || 0);
        USATI.set(who.sub, { giorno: oggi, sec: usati + sec });
        res.json({ testo: g.testo, sec, lingua: String(body.lingua || "it").slice(0, 5), motore: g.modello });
        return;
      } catch (e: any) {
        res.status(502).json({ error: "trascrizione non riuscita: " + (e?.message || String(e)) + (erroreScribe ? " / " + erroreScribe : "") });
        return;
      }
    }
    try {
      const fd = new FormData();
      fd.append("model_id", "scribe_v2");
      fd.append("language_code", String(body.lingua || "it").slice(0, 5));
      fd.append("no_verbatim", "true");
      fd.append("tag_audio_events", "false");
      fd.append("timestamps_granularity", "none");
      const est = /mp4|m4a|aac/.test(mime) ? "m4a" : (/ogg/.test(mime) ? "ogg" : (/wav/.test(mime) ? "wav" : "webm"));
      fd.append("file", new Blob([new Uint8Array(buf)], { type: mime }), "dettato." + est);
      const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": String(chiave) }, body: fd });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = String(j?.detail?.message || j?.detail?.status || j?.detail || r.status);
        res.status(r.status === 401 || r.status === 402 || /quota|credit/i.test(msg) ? 402 : 502).json({ error: "trascrizione non riuscita: " + msg.slice(0, 200) });
        return;
      }
      const sec = Math.round(Number(j?.audio_duration_secs) || durata || 0);
      USATI.set(who.sub, { giorno: oggi, sec: usati + sec });
      res.json({ testo: String(j?.text || "").trim(), sec, lingua: j?.language_code || "", motore: "scribe_v2" });
    } catch (e: any) {
      res.status(502).json({ error: "trascrizione non riuscita: " + (e?.message || String(e)) });
    }
  });
}
