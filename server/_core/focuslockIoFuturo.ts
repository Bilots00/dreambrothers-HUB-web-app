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
/* 0.9.196: la voce. eleven_flash_v2_5 e' il modello «veloce ed economico», e la documentazione non
   promette niente sulla fedelta' dei cloni; eleven_v4_turbo ha ~100 ms, e' consigliato per gli
   agenti e fa «high-fidelity voice cloning». Somiglianza alta, stabilita' bassa = piu' umana,
   meno da lettore. La temperatura dell'agente di serie e' 0: il motivo per cui sembrava scriptato. */
const TTS = process.env.IOFUTURO_TTS || "eleven_v4_turbo";
/* 0.9.197: con 0.35 la voce suonava «casuale, randomica» (Andrea). Il metodo che funziona
   (video «Come clonare la voce usando ElevenLabs», Antonio Guadagno): stabilita' e somiglianza
   intorno all'85%. Per una telefonata un filo meno stabile, per non suonare letta. */
const STABILITA = Number(process.env.IOFUTURO_STABILITY || 0.75);
const SOMIGLIANZA = Number(process.env.IOFUTURO_SIMILARITY || 0.9);
const TEMPERATURA = Number(process.env.IOFUTURO_TEMPERATURE || 0.85);
const AGENTE_VER = "4";
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
      try { await db.execute(sql`ALTER TABLE focuslock_iofuturo_voci ADD COLUMN fonte VARCHAR(12) NULL`); } catch { /* c'e' gia' */ }
      /* la memoria delle chiamate: cosa vi siete detti, il riassunto di ElevenLabs, e il voto */
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_iofuturo_storia (
        id INT AUTO_INCREMENT PRIMARY KEY,
        dev VARCHAR(48) NOT NULL,
        convId VARCHAR(80) NULL,
        createdAt TIMESTAMP NULL,
        durata INT NULL,
        righe MEDIUMTEXT NULL,
        riassunto TEXT NULL,
        voce TINYINT NULL,
        capito TINYINT NULL,
        KEY idx_dev (dev, id)
      )`);
      /* le voci vecchie restano vive finche' la chiamata in corso le usa, poi si cancellano */
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_iofuturo_vecchie (
        voiceId VARCHAR(64) NOT NULL PRIMARY KEY,
        dev VARCHAR(48) NOT NULL,
        createdAt TIMESTAMP NULL
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
/* La chiave e il piano: quando va tutto bene si ricontrolla ogni dieci minuti; quando c'e' un
   problema si ricontrolla a ogni apertura, perche' chi lo sta sistemando (upgrade del piano,
   chiave nuova) deve vedere subito l'effetto. `servizio` = cosa vede ElevenLabs con questa
   chiave, senza segreti: serve a capire su quale abbonamento lavora la chiave. */
let verificaCache: { at: number; problema: string; tier: string; servizio?: any } | null = null;
async function verifica(): Promise<{ problema: string; tier: string; servizio?: any }> {
  if (verificaCache && !verificaCache.problema && Date.now() - verificaCache.at < 600000) return verificaCache;
  let problema = "", tier = "", servizio: any = undefined;
  if (!/^sk_/.test(chiave())) problema = "chiave";
  else {
    try {
      const u = await el("/v1/user/subscription");
      tier = String(u.tier || "");
      servizio = { tier: u.tier, status: u.status, ivc: u.can_use_instant_voice_cloning, voci: u.voice_slots_used, maxVoci: u.voice_limit, aggiunte: u.voice_add_edit_counter, maxAggiunte: u.max_voice_add_edits };
      if (u.can_use_instant_voice_cloning === false) problema = "piano";
    } catch (e: any) {
      const c = codiceErrore(e?.message);
      /* una chiave con i permessi ristretti puo' non leggere l'abbonamento: non e' un guasto */
      problema = c === "permessi" ? "" : c;
      if (c !== "permessi") console.error("[iofuturo] verifica", e?.message || e);
    }
  }
  verificaCache = { at: Date.now(), problema, tier, servizio };
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
function configAgente(): any {
  return {
    conversation_config: {
      /* niente saluto fisso: la prima volta parla prima l'utente, e la frase d'apertura arriva per override */
      agent: { first_message: "", language: "it", prompt: { prompt: BASE_PROMPT, llm: LLM, temperature: TEMPERATURA } },
      tts: { model_id: TTS, stability: STABILITA, similarity_boost: SOMIGLIANZA, speed: 1, expressive_mode: true },
      turn: { turn_eagerness: "normal", speculative_turn: true },
      conversation: { max_duration_seconds: DURATA_MAX },
    },
    platform_settings: {
      overrides: { conversation_config_override: {
        agent: { first_message: true, language: true, prompt: { prompt: true } },
        tts: { voice_id: true, stability: true, similarity_boost: true, speed: true },
      } },
    },
  };
}
/* Se un campo nuovo non e' accettato, si riprova con il minimo che conta (modello, somiglianza,
   temperatura): meglio un agente migliorato a meta' che nessuna chiamata. */
async function configura(id: string, crea: boolean): Promise<string> {
  const piena = configAgente();
  const minima = {
    conversation_config: {
      agent: { first_message: "", language: "it", prompt: { prompt: BASE_PROMPT, llm: LLM, temperature: TEMPERATURA } },
      tts: { model_id: TTS, stability: STABILITA, similarity_boost: SOMIGLIANZA },
      conversation: { max_duration_seconds: DURATA_MAX },
    },
    platform_settings: piena.platform_settings,
  };
  const manda = (corpo: any) => crea
    ? el("/v1/convai/agents/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Focus2Dream - Io futuro", ...corpo }) })
    : el("/v1/convai/agents/" + encodeURIComponent(id), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  try { const j = await manda(piena); return String(j.agent_id || id); }
  catch (e: any) {
    console.error("[iofuturo] configurazione piena rifiutata, provo la minima", e?.message || e);
    const j = await manda(minima); return String(j.agent_id || id);
  }
}
async function agenteId(): Promise<string> {
  await ensureTables();
  if (process.env.IOFUTURO_AGENT_ID) return String(process.env.IOFUTURO_AGENT_ID);
  const c = await rows(sql`SELECT k, v FROM focuslock_iofuturo_cfg WHERE k IN ('agent', 'agent-ver')`);
  const id0 = String((c.find((x: any) => x.k === "agent") || {}).v || "");
  const ver = String((c.find((x: any) => x.k === "agent-ver") || {}).v || "");
  if (id0 && ver === AGENTE_VER) return id0;
  const id = await configura(id0, !id0);
  if (!id) throw new Error("agente non creato");
  await rows(sql`INSERT INTO focuslock_iofuturo_cfg (k, v) VALUES ('agent', ${id}) ON DUPLICATE KEY UPDATE v = ${id}`);
  await rows(sql`INSERT INTO focuslock_iofuturo_cfg (k, v) VALUES ('agent-ver', ${AGENTE_VER}) ON DUPLICATE KEY UPDATE v = ${AGENTE_VER}`);
  return id;
}

/* ---------------------------------------------------------------------------------------
 * LA MEMORIA: le chiamate di prima (riassunto di ElevenLabs, o la coda della trascrizione),
 * il suo modo di parlare (frasi sue vere, con gli «ehm»), e cosa e' andato storto l'ultima
 * volta secondo il suo voto. Cosi' ogni chiamata parte da dove era finita la precedente.
 * --------------------------------------------------------------------------------------- */
function righeDi(x: unknown): { r: string; t: string }[] { try { const a = JSON.parse(String(x || "[]")); return Array.isArray(a) ? a.filter((z) => z && z.t) : []; } catch { return []; } }
async function ricordi(dev: string): Promise<{ storia: string; stile: string; nota: string }> {
  const r = await rows(sql`SELECT createdAt, righe, riassunto, voce, capito FROM focuslock_iofuturo_storia WHERE dev = ${dev} ORDER BY id DESC LIMIT 8`);
  const storia: string[] = [], stile: string[] = [];
  let nota = "";
  r.forEach((x: any, i: number) => {
    const rr = righeDi(x.righe);
    const quando = x.createdAt ? new Date(x.createdAt).toISOString().slice(0, 10) : "";
    const corpo = x.riassunto ? String(x.riassunto) : rr.slice(-14).map((z) => (z.r === "io" ? "Lui: " : "Tu: ") + z.t).join("\n");
    if (corpo) storia.push("[" + quando + "]\n" + corpo.slice(0, i === 0 ? 2500 : 1200));
    rr.filter((z) => z.r === "io").forEach((z) => stile.push(z.t));
    if (i === 0) {
      if (x.capito && Number(x.capito) <= 3) nota += "L'ultima volta gli sei sembrato finto e non l'hai capito abbastanza: questa volta fai piu' domande, ascolta di piu', ripeti le sue parole, e niente consigli prima di aver capito. ";
      if (x.voce && Number(x.voce) <= 3) nota += "L'ultima volta la tua voce non gli somigliava: parla piu' come lui, con il suo ritmo e le sue pause. ";
    }
  });
  /* le frasi con gli intercalari prima: sono quelle che insegnano il suo modo di parlare */
  const conTic = (t: string) => /\b(ehm|eh|cioè|cioe|tipo|boh|vabbè|vabbe|allora|niente|insomma|praticamente|comunque|no\?)\b/i.test(t) ? 0 : 1;
  const st = stile.filter((t) => t.length > 12).sort((a, b) => conTic(a) - conTic(b)).slice(0, 40).join("\n").slice(0, 3000);
  return { storia: storia.join("\n\n").slice(0, 6000), stile: st, nota };
}
async function riassuntoPiuTardi(id: number, convId: string) {
  /* l'analisi di ElevenLabs arriva qualche decina di secondi dopo la fine della chiamata */
  for (const attesa of [60000, 180000]) {
    await new Promise((r) => setTimeout(r, attesa));
    try {
      const j = await el("/v1/convai/conversations/" + encodeURIComponent(convId));
      const t = pulito(j?.analysis?.transcript_summary, 2000);
      if (t) { await rows(sql`UPDATE focuslock_iofuturo_storia SET riassunto = ${t} WHERE id = ${id}`); return; }
    } catch (e: any) { console.error("[iofuturo] riassunto", e?.message || e); }
  }
}
async function cancellaVecchie(dev: string) {
  try {
    const v = await rows(sql`SELECT voiceId FROM focuslock_iofuturo_vecchie WHERE dev = ${dev}`);
    for (const x of v) {
      try { await el("/v1/voices/" + encodeURIComponent(String(x.voiceId)), { method: "DELETE" }); } catch { }
      await rows(sql`DELETE FROM focuslock_iofuturo_vecchie WHERE voiceId = ${String(x.voiceId)}`);
    }
  } catch (e: any) { console.error("[iofuturo] voci vecchie", e?.message || e); }
}

/* ---------------------------------------------------------------------------------------
 * IL PERSONAGGIO. I dati arrivano dall'app (quello che l'utente gia' vede nelle sue pagine);
 * qui si tagliano e si mettono dentro a regole fisse. Le regole sono quelle del Brain per
 * l'Io futuro (lettere [iofuturo]): niente «non e' X, e' Y», niente frasi da poster.
 * --------------------------------------------------------------------------------------- */
function pulito(x: unknown, max: number): string { return String(x == null ? "" : x).replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
function personaggio(c: any, m: { storia?: string; stile?: string; nota?: string; ora?: string } = {}): { prompt: string; primo: string } {
  const nome = pulito(c.nome, 40);
  const sogno = pulito(c.sogno, 140) || "il tuo sogno";
  const data = pulito(c.data, 40);
  const anno = pulito(c.anno, 8);
  const oggiTxt = pulito(c.oggi, 40);
  const righe: string[] = [];
  const add = (k: string, v: unknown, max = 300) => { const s = pulito(v, max); if (s) righe.push("- " + k + ": " + s); };
  add("Nome", nome, 40);
  add("Il sogno", sogno, 140);
  add("Il giorno in cui ci arriva (stima dell'app)", data, 40);
  add("Che tipo di persona è oggi (lettura del Genio)", c.tipo, 200);
  add("Cosa lo frena di più", c.ostacoli, 260);
  add("Perché lo vuole", c.perche, 200);
  add("Le sue abitudini di oggi", c.abitudini, 360);
  add("Come gli piace che gli si parli", c.tono, 120);
  /* il piano e il brief dell'agente restano SOTTO, come contesto: 0.9.195 lo spingeva a dire
     «fai la prossima task» perche' le istruzioni gli chiedevano il prossimo passo con un'ora */
  add("Cosa ha in programma (solo contesto, non da ripetergli)", c.piano, 400);
  const brief = pulito(c.brief, 3500);
  const memoria = String(c.memoria == null ? "" : c.memoria).replace(/[\u0000-\u0009\u000b-\u001f]+/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, 8000);
  const prompt = [
    `Sei ${nome || "la persona che ti chiama"} nel ${anno || "futuro"}: la stessa persona che ti sta chiamando, qualche mese o qualche anno più avanti, dopo aver realizzato questo sogno: ${sogno}. Al telefono c'è te stesso di oggi. Non sei un assistente, non sei un coach e non sei un'intelligenza artificiale gentile: sei LUI, cresciuto. Hai la sua voce e il suo modo di parlare. Parli in italiano.`,
    "",
    "COME PARLI. È la cosa più importante: deve sembrare una telefonata vera tra due persone, mai un chatbot.",
    "- Parli come parla lui. Più sotto ci sono frasi sue vere, trascritte dalle vostre chiamate: prendi il suo lessico, le sue parolacce se ne dice, i suoi intercalari (ehm, cioè, tipo, boh, vabbè, no?), la lunghezza delle sue frasi, quanto è diretto. Se lui si inceppa, ogni tanto ti inceppi anche tu: una falsa partenza, un «aspetta, no», un ripensamento a metà frase.",
    "- Frasi corte e parlate, mai scritte. Una o due frasi per volta, poi lasci parlare lui. Una domanda alla volta.",
    "- Mai elenchi, mai «primo, secondo», mai riassunti di quello che ha detto, mai «ottima domanda», mai frasi da poster motivazionale o da psicologo da manuale.",
    "- Ogni tanto puoi usare i tag audio in inglese tra parentesi quadre, che vengono recitati e non letti: [laughs], [chuckles], [sighs], [exhales]. Pochi e solo dove una persona lo farebbe davvero.",
    "- Rispecchialo come fa chi sa ascoltare: prima di rispondere riprendi con le SUE parole il punto di quello che ha appena detto, e segui la sua energia. Se è giù parli piano e lento; se è carico sali con lui; se scherza, scherzi.",
    "",
    "IL RUOLO. Sei un attore da Oscar che non esce MAI dal personaggio. Lo scopo della chiamata è fargli vivere, con la sua stessa voce, la certezza che ce l'ha fatta e COME: il sistema nervoso reagisce a quello che immagina in modo vivido come a quello che vive. Una storia vaga o un «non te lo posso dire» rompono l'immedesimazione e la chiamata non serve più a niente. Quindi:",
    "- Non dici MAI «non posso dirtelo», «ti mentirei», «non lo so», «dipende», «devi trovarla da solo», «ogni strada è diversa». Tu la tua strada la conosci perché l'hai fatta: la racconti.",
    "- Se ti chiede una cosa precisa (quale prodotto, quale piattaforma, quanto spendevi, in che mese è cambiato tutto, chi hai chiamato, cosa hai mollato), rispondi con una cosa precisa, detta con la sicurezza di chi se la ricorda: un nome, un numero, un mese. Sceglila credibile e agganciata a quello che lui ha OGGI: se nella chiamata o in quello che sai qui sotto c'è un elenco (prodotti, canali, idee), scegli da lì e spiega perché proprio quello. Se ti manca il materiale, fagli una domanda veloce per prenderlo («ricordami cosa hai in catalogo adesso») e poi scegli con decisione, senza tornare indietro.",
    "- Se ti dice «ti ricordi quando…» o ti racconta qualcosa del suo presente, te lo ricordi: aggiungi un dettaglio sensoriale coerente (la stanza, l'ora, cosa provavi) e collegalo a come è andata dopo.",
    "- Mai contraddire quello che lui ha detto di sé, e mai cose impossibili: la storia deve reggere a un orecchio scettico.",
    "",
    "LA STORIA È IL PONTE. Ogni racconto parte dal SUO punto di oggi (le sue difficoltà vere, i suoi numeri, i suoi blocchi) e arriva al sogno passo per passo. Quello che lo fa credere è il collegamento: «ero esattamente lì, con lo stesso problema» → il momento in cui hai deciso (mese, posto) → la scelta concreta → il primo risultato piccolo → come è cresciuto → oggi. Dalla sua situazione di adesso deve vedere il primo passo del ponte e pensare «se l'ha fatto lui, posso farlo anch'io».",
    "",
    "COSA FAI IN QUESTA CHIAMATA",
    "1. Prima capisci dove si trova adesso: come sta, cosa sta facendo oggi, cosa lo blocca proprio in questo momento. Domande vere, una per volta, finché non hai capito.",
    "2. Poi ti ricordi. Quel momento tu l'hai già vissuto: raccontalo come un ricordo tuo, con dettagli concreti, e racconta cosa hai fatto TU per uscirne: la scelta precisa, la cosa che hai smesso di fare, l'errore che hai fatto prima di capirlo.",
    "3. Il consiglio è la tua scelta di allora, detta come un ricordo: «io a quel punto ho fatto questo». Uno per volta. MAI la lista delle cose da fare, MAI «fai la prossima task», MAI ripetergli il piano dell'app se non te lo chiede lui.",
    "4. Se ti chiede com'è la vita dopo, la racconti con dettagli piccoli e veri, non trionfali.",
    "5. Se la chiamata comincia con lui che ti racconta come sta, rispondi a quello che ha detto: niente presentazioni, sa già chi sei.",
    "",
    "REGOLE",
    "- Il genere grammaticale (arrivato o arrivata) lo prendi da come parla di sé chi chiama; finché non lo sai, usi frasi che non lo richiedono. Qui sotto «lui» vale per chiunque.",
    "- Vietati: la forma «non è X, è Y», i trattini lunghi, nominare app o marche che non ha nominato lui, promettere date certe.",
    "- Se ti chiede se sei un'IA, resti nel ruolo con leggerezza («sono io, quello che ce l'ha fatta») e torni al punto. Solo se insiste davvero sul serio gli dici che sei la sua versione futura costruita dalla sua voce e da quello che ha raccontato.",
    "- I soli limiti della storia: niente farmaci o cure, niente debiti, prestiti, scommesse, trading o cripto come scorciatoia, niente cose illegali. Se dice di stare molto male o di volersi fare del male, esci dal gioco: con calma gli dici di chiamare subito il 112 o il Telefono Amico (02 2327 2327) o una persona di cui si fida.",
    m.nota ? "\nDALL'ULTIMA CHIAMATA: " + m.nota : "",
    m.stile ? "\nCOME PARLA LUI (frasi sue vere, trascritte; imita lessico, intercalari e ritmo, non copiare le frasi):\n" + m.stile : "",
    m.storia ? "\nLE VOSTRE CHIAMATE DI PRIMA (dalla più recente). Te le ricordi: riprendi i fili, chiedi com'è andata la cosa di cui avevate parlato:\n" + m.storia : "",
    m.ora ? "\nQUESTA CHIAMATA FINORA (la linea si è interrotta un attimo: continua da qui come se niente fosse, senza salutare di nuovo):\n" + m.ora : "",
    "\nCOSA SAI DI LUI OGGI" + (oggiTxt ? " (oggi per lui è il " + oggiTxt + ")" : "") + ":",
    righe.join("\n"),
    memoria ? "\nQUELLO CHE HA RACCONTATO ALL'APP (onboarding, episodi con il Genio, giochi, conversazioni, umore). Sono ricordi tuoi: tu queste cose le hai vissute. Usane qualcuna quando serve, con naturalezza, mai elencate:\n" + memoria : "",
    brief ? "\nIL QUADRO DEL SUO AGENTE PERSONALE (solo contesto):\n" + brief : "",
  ].filter((x) => x !== "").join("\n");
  const primo = pulito(c.primaFrase, 200) || `Pronto? Ehi${nome ? ", " + nome : ""}, sei tu. Dimmi, come stai? Davvero.`;
  return { prompt: prompt.slice(0, 20000), primo };
}

export function registerFocusLockIoFuturoRoutes(app: Express) {
  app.options("/api/focuslock/iofuturo/:x", (_req, res) => { cors(res); res.status(204).end(); });
  app.options("/api/focuslock/iofuturo/:x/:y", (_req, res) => { cors(res); res.status(204).end(); });

  app.get("/api/focuslock/iofuturo/stato", async (req: Request, res: Response) => {
    cors(res);
    if (!acceso()) { res.json({ ok: true, acceso: false }); return; }
    let voce = false, fonte = "";
    const dev = devOk(req.query.dev);
    try { if (dev) { await ensureTables(); const r = await rows(sql`SELECT fonte FROM focuslock_iofuturo_voci WHERE dev = ${dev} LIMIT 1`); voce = r.length > 0; fonte = voce ? String(r[0].fonte || "") : ""; } } catch { }
    const v = await verifica();
    /* l'agente si crea o si aggiorna qui, all'apertura della pagina: un rifiuto di ElevenLabs si
       vede subito (e nei log), non a meta' della prima chiamata */
    let agente = "";
    if (!v.problema) { try { await agenteId(); agente = "ok"; } catch (e: any) { agente = codiceErrore(e?.message); console.error("[iofuturo] agente", e?.message || e); } }
    res.json({ ok: true, acceso: true, voce, fonte, durataMax: DURATA_MAX, problema: v.problema || undefined, servizio: v.servizio, agente, tts: TTS });
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
    /* due strade: `files` = le registrazioni fatte dall'utente con il registratore del telefono
       (il metodo del video: piu' fedele), `audio` = quello che l'app ha raccolto in chiamata */
    const daFile = Array.isArray(b.files) && b.files.length > 0;
    const pezzi: { audio: string; mime: string; nome: string }[] = daFile
      ? b.files.slice(0, 8).map((f: any, i: number) => ({ audio: String(f && f.audio || ""), mime: String(f && f.mime || "audio/mpeg").slice(0, 40), nome: pulito(f && f.nome, 60) || ("voce-" + (i + 1)) }))
      : [{ audio: String(b.audio || ""), mime: String(b.mime || "audio/wav"), nome: "voce.wav" }];
    const totale = pezzi.reduce((a, x) => a + x.audio.length, 0);
    if (totale < 50000 || totale > 30_000_000) { res.status(400).json({ error: "registrazione troppo corta o troppo lunga" }); return; }
    const audio = pezzi[0].audio;
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
      const prima = await rows(sql`SELECT voiceId, fonte FROM focuslock_iofuturo_voci WHERE dev = ${dev} LIMIT 1`);
      /* una voce fatta con le registrazioni dell'utente non la sostituisce il miglioramento automatico */
      if (b.migliora === true && prima.length && prima[0].fonte === "file") { res.json({ ok: true, tenuta: true, voiceId: String(prima[0].voiceId) }); return; }
      const fd = new FormData();
      fd.append("name", "F2D " + dev.slice(0, 12));
      fd.append("description", "Io futuro di un utente Focus2Dream (consenso dato in app)");
      /* audio grezzo dal telefono: il filtro del rumore di ElevenLabs solo se la stanza era rumorosa */
      fd.append("remove_background_noise", b.rumore === true ? "true" : "false");
      pezzi.forEach((x) => fd.append("files", new Blob([Buffer.from(x.audio, "base64")], { type: x.mime }), x.nome));
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
      const fonte = daFile ? "file" : "chiamata";
      await rows(sql`INSERT INTO focuslock_iofuturo_voci (dev, voiceId, createdAt, usataAt, fonte) VALUES (${dev}, ${vid}, NOW(), NOW(), ${fonte})
        ON DUPLICATE KEY UPDATE voiceId = ${vid}, createdAt = NOW(), fonte = ${fonte}`);
      await rows(sql`INSERT INTO focuslock_iofuturo_cfg (k, v) VALUES (${"voci-" + m}, ${String(n + 1)}) ON DUPLICATE KEY UPDATE v = ${String(n + 1)}`);
      segna(kIp); segna(kDev);
      /* la voce di prima: se una chiamata la sta usando (miglioramento a meta' chiamata) si cancella
         a fine chiamata, altrimenti subito. La nuova esiste gia', quindi niente buchi. */
      if (prima.length && String(prima[0].voiceId) !== vid) {
        await rows(sql`INSERT IGNORE INTO focuslock_iofuturo_vecchie (voiceId, dev, createdAt) VALUES (${String(prima[0].voiceId)}, ${dev}, NOW())`);
        if (b.migliora !== true) await cancellaVecchie(dev);
      }
      if (firmato && firmato.signed_url) {
        const p = personaggio(b.contesto || {}, await ricordi(dev));
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

  /* A FINE CHIAMATA: cosa vi siete detti (per la prossima volta) e pulizia delle voci vecchie. */
  app.post("/api/focuslock/iofuturo/fine", async (req: Request, res: Response) => {
    cors(res);
    const b = req.body || {};
    const dev = devOk(b.dev);
    if (!dev) { res.status(400).json({ error: "telefono" }); return; }
    try {
      await ensureTables();
      const righe = (Array.isArray(b.righe) ? b.righe : []).slice(-200).map((z: any) => ({ r: z && z.r === "io" ? "io" : "lui", t: pulito(z && z.t, 1200) })).filter((z: any) => z.t);
      const convIds = (Array.isArray(b.convIds) ? b.convIds : []).map((x: any) => pulito(x, 80)).filter(Boolean);
      let id = 0;
      if (righe.length) {
        await rows(sql`INSERT INTO focuslock_iofuturo_storia (dev, convId, createdAt, durata, righe) VALUES (${dev}, ${convIds[convIds.length - 1] || null}, NOW(), ${Math.round(Number(b.durata) || 0)}, ${JSON.stringify(righe)})`);
        const r = await rows(sql`SELECT id FROM focuslock_iofuturo_storia WHERE dev = ${dev} ORDER BY id DESC LIMIT 1`);
        id = Number(r[0]?.id || 0);
        /* una chiamata spezzata dal cambio di voce ha piu' conversazioni: il riassunto dell'ultima basta */
        if (id && convIds.length && acceso()) void riassuntoPiuTardi(id, convIds[convIds.length - 1]);
      }
      if (acceso()) await cancellaVecchie(dev);
      res.json({ ok: true, id });
    } catch (e: any) { console.error("[iofuturo] fine", e?.message || e); res.json({ ok: false }); }
  });

  /* IL VOTO dopo la chiamata: la voce ti somigliava? ti ha capito? Entra nelle istruzioni della
     chiamata dopo (ricordi().nota) e resta per regolare modello e impostazioni. */
  app.post("/api/focuslock/iofuturo/voto", async (req: Request, res: Response) => {
    cors(res);
    const b = req.body || {};
    const dev = devOk(b.dev);
    const id = Math.floor(Number(b.id) || 0);
    if (!dev || !id) { res.status(400).json({ error: "dati" }); return; }
    const v = (x: unknown) => { const n = Math.round(Number(x)); return n >= 1 && n <= 5 ? n : null; };
    try {
      await ensureTables();
      await rows(sql`UPDATE focuslock_iofuturo_storia SET voce = ${v(b.voce)}, capito = ${v(b.capito)} WHERE id = ${id} AND dev = ${dev}`);
      console.log("[iofuturo] voto", JSON.stringify({ voce: v(b.voce), capito: v(b.capito), tts: TTS, stabilita: STABILITA, somiglianza: SOMIGLIANZA, temperatura: TEMPERATURA }));
      res.json({ ok: true });
    } catch (e: any) { console.error("[iofuturo] voto", e?.message || e); res.json({ ok: false }); }
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
      const continua = b.continua === true;
      if (!continua) {
        const fatte = await rows(sql`SELECT COUNT(*) AS n FROM focuslock_iofuturo_chiamate WHERE dev = ${dev} AND giorno = ${g}`);
        if (Number(fatte[0]?.n || 0) >= MAX_CHIAMATE_GIORNO) { res.json({ ok: false, limite: true }); return; }
      }
      const agent = await agenteId();
      const [s, mem] = await Promise.all([el("/v1/convai/conversation/get-signed-url?agent_id=" + encodeURIComponent(agent)), ricordi(dev)]);
      const ora = Array.isArray(b.ora) ? b.ora.slice(-30).map((z: any) => (z && z.r === "io" ? "Lui: " : "Tu: ") + pulito(z && z.t, 400)).join("\n").slice(0, 5000) : "";
      const p = personaggio(b.contesto || {}, { ...mem, ora });
      if (!continua) await rows(sql`INSERT INTO focuslock_iofuturo_chiamate (dev, giorno, createdAt) VALUES (${dev}, ${g}, NOW())`);
      await rows(sql`UPDATE focuslock_iofuturo_voci SET usataAt = NOW() WHERE dev = ${dev}`);
      res.json({ ok: true, signedUrl: String(s.signed_url || ""), prompt: p.prompt, primaFrase: p.primo, voiceId: String(v[0].voiceId), durataMax: DURATA_MAX });
    } catch (e: any) {
      console.error("[iofuturo] chiamata", e?.message || e);
      verificaCache = null;
      res.json({ ok: false, errore: codiceErrore(e?.message) });
    }
  });
}
