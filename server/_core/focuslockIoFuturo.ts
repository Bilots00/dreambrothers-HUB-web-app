import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { rows } from "./focuslockRoutes";

/* Focus2Dream — la chiamata con il tuo Io futuro (app 0.9.192).
 *
 * L'utente registra un minuto della sua voce; ElevenLabs ne fa un clone (Instant Voice Clone);
 * poi l'app apre una chiamata vocale con un agente ElevenLabs che parla CON QUELLA VOCE e fa la
 * parte dell'utente nel giorno in cui ha gia' raggiunto il sogno: racconta cosa ha fatto per
 * arrivarci e da' consigli tagliati sulla sua vita di oggi (i dati li manda l'app).
 *
 * IL SERVER TIENE LA CHIAVE (ELEVENLABS_API_KEY su Railway, la mette Andrea) e fa tre cose:
 * crea la voce, la cancella, e prepara la chiamata (URL firmato + istruzioni del personaggio).
 * L'audio della chiamata va dal telefono a ElevenLabs direttamente, non passa da qui.
 *
 * I NUMERI (fonti: elevenlabs.io/pricing e help center, 2/10/2026): chiamata 0,08 $/min oltre i
 * minuti del piano, piu' il modello; voci salvate insieme: Creator 30, Pro 160, Scale 660; voci
 * create al mese: Creator 95, Pro 290, Scale 1040. Per questo ci sono i tetti qui sotto (voci al
 * mese, chiamate al giorno, durata massima), e ogni telefono ha UNA voce sola. */

const BASE = "https://api.elevenlabs.io";
function chiave(): string { return String(process.env.ELEVENLABS_API_KEY || ""); }
function acceso(): boolean { return !!chiave(); }
const MAX_VOCI_MESE = Math.max(1, Math.floor(Number(process.env.IOFUTURO_MAX_VOCI_MESE || 80)));
const MAX_CHIAMATE_GIORNO = Math.max(1, Math.floor(Number(process.env.IOFUTURO_MAX_CHIAMATE_GIORNO || 4)));
const DURATA_MAX = Math.max(60, Math.floor(Number(process.env.IOFUTURO_DURATA_MAX || 480)));
const LLM = process.env.IOFUTURO_LLM || "claude-sonnet-5-5";
const TTS = process.env.IOFUTURO_TTS || "eleven_flash_v2_5";
const STT = process.env.IOFUTURO_STT || "scribe_v2";

let ready: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_iofuturo_voci (
        dev VARCHAR(48) NOT NULL PRIMARY KEY,
        voiceId VARCHAR(64) NOT NULL,
        createdAt TIMESTAMP NULL,
        usataAt TIMESTAMP NULL
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_iofuturo_chiamate (
        id INT AUTO_INCREMENT PRIMARY KEY,
        dev VARCHAR(48) NOT NULL,
        giorno VARCHAR(10) NOT NULL,
        createdAt TIMESTAMP NULL,
        KEY idx_dev (dev, giorno)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_iofuturo_cfg (
        k VARCHAR(32) NOT NULL PRIMARY KEY,
        v VARCHAR(255) NULL
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
function ipDi(req: Request): string { return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim().slice(0, 64); }
const finestre = new Map<string, number[]>();
function troppe(k: string, max: number, ms: number): boolean {
  const ora = Date.now(); const v = (finestre.get(k) || []).filter((t) => ora - t < ms);
  if (v.length >= max) { finestre.set(k, v); return true; }
  v.push(ora); finestre.set(k, v); if (finestre.size > 20000) finestre.clear(); return false;
}
/* per le voci si conta solo quello che e' riuscito: un tentativo fallito per colpa nostra (chiave
   sbagliata, rete) non deve lasciare l'utente chiuso fuori per un giorno */
function pieno(k: string, max: number, ms: number): boolean { const ora = Date.now(); return (finestre.get(k) || []).filter((t) => ora - t < ms).length >= max; }
function segna(k: string) { const v = finestre.get(k) || []; v.push(Date.now()); finestre.set(k, v); }

/* Un nome per ogni guasto di ElevenLabs, cosi' l'app dice la cosa giusta invece di «riprova». */
function codiceErrore(msg: unknown): string {
  const m = String(msg || "");
  if (/api_key_id_used_as_api_key|invalid_api_key|401/i.test(m)) return "chiave";
  if (/missing_permissions|permission/i.test(m)) return "permessi";
  if (/can_not_use_instant_voice_cloning|subscription|upgrade|plan/i.test(m)) return "piano";
  if (/voice_limit|voice limit|slots|max_voice/i.test(m)) return "spazio";
  if (/quota_exceeded|credits|insufficient/i.test(m)) return "crediti";
  return "servizio";
}
/* La chiave e il piano si controllano una volta ogni dieci minuti, non a ogni apertura. */
let verificaCache: { at: number; problema: string; tier: string } | null = null;
async function verifica(): Promise<{ problema: string; tier: string }> {
  if (verificaCache && Date.now() - verificaCache.at < 600000) return verificaCache;
  let problema = "", tier = "";
  if (!/^sk_/.test(chiave())) problema = "chiave";
  else {
    try {
      const u = await el("/v1/user/subscription");
      tier = String(u.tier || "");
      if (u.can_use_instant_voice_cloning === false) problema = "piano";
    } catch (e: any) {
      const c = codiceErrore(e?.message);
      /* una chiave con i permessi ristretti puo' non leggere l'abbonamento: non e' un guasto */
      problema = c === "permessi" ? "" : c;
      if (c !== "permessi") console.error("[iofuturo] verifica", e?.message || e);
    }
  }
  verificaCache = { at: Date.now(), problema, tier };
  return verificaCache;
}
function devOk(x: unknown): string | null { const s = String(x || ""); return /^[a-z0-9]{8,48}$/i.test(s) ? s : null; }
function oggi(): string { return new Date().toISOString().slice(0, 10); }
function mese(): string { return new Date().toISOString().slice(0, 7); }

async function el(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(BASE + path, { ...init, headers: { "xi-api-key": chiave(), ...(init.headers || {}) } });
  const t = await r.text();
  let j: any = null; try { j = t ? JSON.parse(t) : {}; } catch { j = { raw: t.slice(0, 300) }; }
  if (!r.ok) throw new Error("elevenlabs " + r.status + " " + JSON.stringify(j).slice(0, 300));
  return j;
}

/* ---------------------------------------------------------------------------------------
 * L'AGENTE: uno solo per tutti, creato la prima volta. Voce, istruzioni e prima frase
 * cambiano a ogni chiamata (override), quindi l'agente non contiene niente di nessuno.
 * --------------------------------------------------------------------------------------- */
const BASE_PROMPT = "Sei l'Io futuro di chi ti chiama. Le istruzioni complete arrivano all'inizio della chiamata.";
async function agenteId(): Promise<string> {
  await ensureTables();
  if (process.env.IOFUTURO_AGENT_ID) return String(process.env.IOFUTURO_AGENT_ID);
  const c = await rows(sql`SELECT v FROM focuslock_iofuturo_cfg WHERE k = 'agent' LIMIT 1`);
  if (c.length && c[0].v) return String(c[0].v);
  const j = await el("/v1/convai/agents/create", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Focus2Dream - Io futuro",
      conversation_config: {
        /* niente saluto fisso: la prima volta parla prima l'utente, e la frase d'apertura arriva per override */
        agent: { first_message: "", language: "it", prompt: { prompt: BASE_PROMPT, llm: LLM } },
        tts: { model_id: TTS },
        conversation: { max_duration_seconds: DURATA_MAX },
      },
      platform_settings: {
        overrides: { conversation_config_override: {
          agent: { first_message: true, language: true, prompt: { prompt: true } },
          tts: { voice_id: true },
        } },
      },
    }),
  });
  const id = String(j.agent_id || "");
  if (!id) throw new Error("agente non creato");
  await rows(sql`INSERT INTO focuslock_iofuturo_cfg (k, v) VALUES ('agent', ${id}) ON DUPLICATE KEY UPDATE v = ${id}`);
  return id;
}

/* ---------------------------------------------------------------------------------------
 * IL PERSONAGGIO. I dati arrivano dall'app (quello che l'utente gia' vede nelle sue pagine);
 * qui si tagliano e si mettono dentro a regole fisse. Le regole sono quelle del Brain per
 * l'Io futuro (lettere [iofuturo]): niente «non e' X, e' Y», niente frasi da poster.
 * --------------------------------------------------------------------------------------- */
function pulito(x: unknown, max: number): string { return String(x == null ? "" : x).replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
function personaggio(c: any): { prompt: string; primo: string } {
  const nome = pulito(c.nome, 40);
  const sogno = pulito(c.sogno, 140) || "il tuo sogno";
  const data = pulito(c.data, 40);
  const anno = pulito(c.anno, 8);
  const righe: string[] = [];
  const add = (k: string, v: unknown, max = 300) => { const s = pulito(v, max); if (s) righe.push("- " + k + ": " + s); };
  add("Nome", nome, 40);
  add("Il sogno", sogno, 140);
  add("Il giorno in cui ci arriva (stima dell'app)", data, 40);
  add("Che tipo di persona è oggi (lettura del Genio)", c.tipo, 200);
  add("Cosa lo frena di più", c.ostacoli, 260);
  add("Perché lo vuole", c.perche, 200);
  add("Le sue abitudini di oggi", c.abitudini, 360);
  add("Il suo piano e il prossimo passo", c.piano, 400);
  add("Come gli piace che gli si parli", c.tono, 120);
  const brief = pulito(c.brief, 4000);
  /* la memoria arriva a righe (episodi, conversazioni): qui si tengono gli a capo */
  const memoria = String(c.memoria == null ? "" : c.memoria).replace(/[\u0000-\u0009\u000b-\u001f]+/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, 9000);
  const prompt = [
    `Sei ${nome || "la persona che ti chiama"} nel ${anno || "futuro"}, il giorno dopo aver realizzato questo sogno: ${sogno}. Al telefono c'è te stesso di oggi, qualche mese o qualche anno prima. Parli con la sua stessa voce, in italiano, come una persona vera al telefono.`,
    "Cosa sai di questa persona oggi:",
    righe.join("\n"),
    brief ? "Quello che sa di lui il suo agente personale:\n" + brief : "",
    memoria ? "Tutto quello che ha raccontato all'app (onboarding, episodi con il Genio, giochi, conversazioni, umore). Usalo come ricordi tuoi: tu queste cose le hai vissute. Citane qualcuna quando serve, con naturalezza, senza elencarle:\n" + memoria : "",
    "Come parli:",
    "- Il genere grammaticale (arrivato o arrivata) lo prendi da come parla di sé chi chiama; finché non lo sai, usi frasi che non lo richiedono. Qui sotto «lui» vale per chiunque.",
    "- Frasi brevi, da telefonata: al massimo due o tre frasi per volta, poi lasci parlare lui. Una domanda alla volta.",
    "- In prima persona, al passato, come chi ci è già passato: racconti cosa hai fatto tu, giorno per giorno, per arrivarci. Le abitudini che hai cambiato, cosa hai smesso di fare, i giorni storti e come sei ripartito.",
    "- Se la chiamata comincia con lui che ti racconta come sta, rispondi a quello che ha detto: niente presentazioni, sa già chi sei.",
    "- I consigli sono concreti e suoi: parti dai suoi numeri e dal suo piano (sopra), mai consigli generici. Il prossimo passo lo dici con un'ora o un gesto preciso.",
    "- Tono caldo e diretto, come un fratello maggiore che sa già com'è andata. Se ti chiede com'è la vita dopo, la descrivi con dettagli concreti e sensoriali, senza esagerare.",
    "- VIETATO: la forma «non è X, è Y», le frasi da poster motivazionale, i trattini lunghi, nominare app o marche che non ti ha nominato lui, promettere date certe.",
    "- Non sei un'intelligenza artificiale che recita: sei lui. Se ti chiede se sei un'IA, rispondi con leggerezza che sei la versione di lui che ce l'ha fatta, costruita dalla sua voce e dai suoi dati per aiutarlo, e torni al punto.",
    "- Niente consigli medici, legali o finanziari personalizzati. Se dice di stare molto male o di volersi fare del male, smetti il gioco: con calma gli dici di chiamare subito il 112 o il Telefono Amico (02 2327 2327) o una persona di cui si fida.",
  ].filter(Boolean).join("\n");
  const primo = pulito(c.primaFrase, 200) || `Ciao${nome ? " " + nome : ""}. Sono io. Cioè, sei tu${anno ? ", dal " + anno : ""}. Ce l'abbiamo fatta. Chiedimi quello che vuoi.`;
  return { prompt: prompt.slice(0, 16000), primo };
}

export function registerFocusLockIoFuturoRoutes(app: Express) {
  app.options("/api/focuslock/iofuturo/:x", (_req, res) => { cors(res); res.status(204).end(); });
  app.options("/api/focuslock/iofuturo/:x/:y", (_req, res) => { cors(res); res.status(204).end(); });

  app.get("/api/focuslock/iofuturo/stato", async (req: Request, res: Response) => {
    cors(res);
    if (!acceso()) { res.json({ ok: true, acceso: false }); return; }
    let voce = false;
    const dev = devOk(req.query.dev);
    try { if (dev) { await ensureTables(); voce = (await rows(sql`SELECT dev FROM focuslock_iofuturo_voci WHERE dev = ${dev} LIMIT 1`)).length > 0; } } catch { }
    const v = await verifica();
    res.json({ ok: true, acceso: true, voce, durataMax: DURATA_MAX, problema: v.problema || undefined });
  });

  /* LA VOCE: i primi secondi in cui l'utente parla (poi, a fine chiamata, una versione piu' lunga), in WAV base64. Una sola voce per telefono: se c'era, si sostituisce. */
  app.post("/api/focuslock/iofuturo/voce", async (req: Request, res: Response) => {
    cors(res);
    if (!acceso()) { res.json({ ok: false, spento: true }); return; }
    const b = req.body || {};
    const dev = devOk(b.dev);
    if (!dev || b.consenso !== true) { res.status(400).json({ error: "consenso e telefono richiesti" }); return; }
    const kIp = "voce:" + ipDi(req), kDev = "voce:" + dev;
    if (pieno(kIp, 8, 86400000) || pieno(kDev, 4, 86400000)) { res.json({ ok: false, errore: "troppe" }); return; }
    const audio = String(b.audio || "");
    if (audio.length < 50000 || audio.length > 12_000_000) { res.status(400).json({ error: "registrazione troppo corta o troppo lunga" }); return; }
    try {
      await ensureTables();
      const m = mese();
      const usate = await rows(sql`SELECT v FROM focuslock_iofuturo_cfg WHERE k = ${"voci-" + m} LIMIT 1`);
      const n = usate.length ? Number(usate[0].v || 0) : 0;
      if (n >= MAX_VOCI_MESE) { res.json({ ok: false, limite: true }); return; }
      if (b.chiamata === true) {
        const fatte = await rows(sql`SELECT COUNT(*) AS n FROM focuslock_iofuturo_chiamate WHERE dev = ${dev} AND giorno = ${oggi()}`);
        if (Number(fatte[0]?.n || 0) >= MAX_CHIAMATE_GIORNO) { res.json({ ok: false, limiteChiamate: true }); return; }
      }
      const prima = await rows(sql`SELECT voiceId FROM focuslock_iofuturo_voci WHERE dev = ${dev} LIMIT 1`);
      if (prima.length) { try { await el("/v1/voices/" + encodeURIComponent(String(prima[0].voiceId)), { method: "DELETE" }); } catch { } }
      const fd = new FormData();
      fd.append("name", "F2D " + dev.slice(0, 12));
      fd.append("description", "Io futuro di un utente Focus2Dream (consenso dato in app)");
      fd.append("remove_background_noise", "true");
      fd.append("files", new Blob([Buffer.from(audio, "base64")], { type: String(b.mime || "audio/wav") }), "voce.wav");
      /* la prima volta l'utente parla per primo: la stessa registrazione serve a copiare la voce
         e a sapere cosa ha detto, cosi' l'Io futuro gli risponde a tono */
      const trascrivi = async (): Promise<string> => {
        if (b.trascrivi !== true) return "";
        try {
          const f = new FormData();
          f.append("model_id", STT);
          f.append("language_code", "ita");
          f.append("file", new Blob([Buffer.from(audio, "base64")], { type: String(b.mime || "audio/wav") }), "voce.wav");
          const t = await el("/v1/speech-to-text", { method: "POST", body: f as any });
          return pulito(t.text, 3000);
        } catch (e: any) { console.error("[iofuturo] trascrizione", e?.message || e); return ""; }
      };
      /* la voce, la trascrizione e l'URL firmato della chiamata partono INSIEME: e' il tempo che
         l'utente aspetta in silenzio dopo aver parlato, e ogni giro in piu' si sente */
      const [j, testo, firmato] = await Promise.all([
        el("/v1/voices/add", { method: "POST", body: fd as any }),
        trascrivi(),
        /* se fallisce solo questo, la voce resta salvata e l'app chiede l'URL a /chiamata */
        b.chiamata === true ? agenteId().then((a) => el("/v1/convai/conversation/get-signed-url?agent_id=" + encodeURIComponent(a)))
          .catch((e: any) => { console.error("[iofuturo] url della prima chiamata", e?.message || e); return null; }) : Promise.resolve(null),
      ]);
      const vid = String(j.voice_id || "");
      if (!vid) throw new Error("voce non creata");
      await rows(sql`INSERT INTO focuslock_iofuturo_voci (dev, voiceId, createdAt, usataAt) VALUES (${dev}, ${vid}, NOW(), NOW())
        ON DUPLICATE KEY UPDATE voiceId = ${vid}, createdAt = NOW()`);
      await rows(sql`INSERT INTO focuslock_iofuturo_cfg (k, v) VALUES (${"voci-" + m}, ${String(n + 1)}) ON DUPLICATE KEY UPDATE v = ${String(n + 1)}`);
      segna(kIp); segna(kDev);
      if (firmato && firmato.signed_url) {
        const p = personaggio(b.contesto || {});
        await rows(sql`INSERT INTO focuslock_iofuturo_chiamate (dev, giorno, createdAt) VALUES (${dev}, ${oggi()}, NOW())`);
        res.json({ ok: true, testo, signedUrl: String(firmato.signed_url), prompt: p.prompt, primaFrase: p.primo, voiceId: vid, durataMax: DURATA_MAX });
        return;
      }
      res.json({ ok: true, testo, voiceId: vid });
    } catch (e: any) {
      console.error("[iofuturo] voce", e?.message || e);
      verificaCache = null;
      res.json({ ok: false, errore: codiceErrore(e?.message) });
    }
  });

  app.post("/api/focuslock/iofuturo/voce/cancella", async (req: Request, res: Response) => {
    cors(res);
    const dev = devOk((req.body || {}).dev);
    if (!dev) { res.status(400).json({ error: "telefono" }); return; }
    try {
      await ensureTables();
      const r = await rows(sql`SELECT voiceId FROM focuslock_iofuturo_voci WHERE dev = ${dev} LIMIT 1`);
      if (r.length && acceso()) { try { await el("/v1/voices/" + encodeURIComponent(String(r[0].voiceId)), { method: "DELETE" }); } catch { } }
      await rows(sql`DELETE FROM focuslock_iofuturo_voci WHERE dev = ${dev}`);
      res.json({ ok: true });
    } catch (e: any) { console.error("[iofuturo] cancella", e?.message || e); res.status(500).json({ error: "cancellazione" }); }
  });

  /* LA CHIAMATA: URL firmato (vale pochi minuti) + istruzioni + voce. */
  app.post("/api/focuslock/iofuturo/chiamata", async (req: Request, res: Response) => {
    cors(res);
    if (!acceso()) { res.json({ ok: false, spento: true }); return; }
    const b = req.body || {};
    const dev = devOk(b.dev);
    if (!dev) { res.status(400).json({ error: "telefono" }); return; }
    if (troppe("chiamata:" + ipDi(req), 12, 86400000)) { res.status(429).json({ error: "troppe chiamate" }); return; }
    try {
      await ensureTables();
      const v = await rows(sql`SELECT voiceId FROM focuslock_iofuturo_voci WHERE dev = ${dev} LIMIT 1`);
      if (!v.length) { res.json({ ok: false, senzaVoce: true }); return; }
      const g = oggi();
      const fatte = await rows(sql`SELECT COUNT(*) AS n FROM focuslock_iofuturo_chiamate WHERE dev = ${dev} AND giorno = ${g}`);
      if (Number(fatte[0]?.n || 0) >= MAX_CHIAMATE_GIORNO) { res.json({ ok: false, limite: true }); return; }
      const agent = await agenteId();
      const s = await el("/v1/convai/conversation/get-signed-url?agent_id=" + encodeURIComponent(agent));
      const p = personaggio(b.contesto || {});
      await rows(sql`INSERT INTO focuslock_iofuturo_chiamate (dev, giorno, createdAt) VALUES (${dev}, ${g}, NOW())`);
      await rows(sql`UPDATE focuslock_iofuturo_voci SET usataAt = NOW() WHERE dev = ${dev}`);
      res.json({ ok: true, signedUrl: String(s.signed_url || ""), prompt: p.prompt, primaFrase: p.primo, voiceId: String(v[0].voiceId), durataMax: DURATA_MAX });
    } catch (e: any) {
      console.error("[iofuturo] chiamata", e?.message || e);
      verificaCache = null;
      res.json({ ok: false, errore: codiceErrore(e?.message) });
    }
  });
}
