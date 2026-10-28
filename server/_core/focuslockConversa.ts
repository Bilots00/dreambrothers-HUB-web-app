import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "../db";
import { whoIs, isIdentity, rows } from "./focuslockRoutes";

/* DreamMap 0.9.301 — LA REVISIONE E IL RIENTRA IN ROTTA, IN CHAT CON IL TUO AGENTE
 *
 * Andrea: "nella revisione della sera e nel ricalcolo della rotta non c'e' nessuna conversazione con un LLM. Il Genio
 * parla a copione con le stesse opzioni: non contestualizza, non dice 'ho capito'". Con Premium la revisione (della
 * sera, della settimana, del mese, del trimestre, dell'anno) e il Rientra in rotta diventano una chat con il proprio
 * agente: a ogni messaggio il modello legge la conversazione e i dati veri della giornata (tempo per fascia oraria, app,
 * sessioni di Full Focus, la priorita'), risponde riprendendo quello che la persona ha detto e fa UNA domanda. Le
 * risposte pronte di oggi restano come pillole sopra al campo: le sceglie l'app per la fase che il modello indica.
 * Quando la persona dice cosa l'ha portata fuori strada (il grilletto), il modello propone un piano su misura (un
 * blocco, un limite, o una prevenzione): l'app lo applica SOLO con il si' della persona.
 *
 * Il modello e' quello veloce ed economico gia' acceso su Railway (Gemini Flash-Lite con DREAMMAP_GEMINI_KEY), con
 * Claude Haiku come riserva (AGENT_LLM_KEY). Niente crediti: un tetto al giorno per persona. Il testo non si salva.
 * Senza chiavi la rotta risponde 503 e l'app torna al Genio a opzioni.
 *
 * I DATI CHE INSEGNANO AL GENIO (alla Akinator). Con il consenso esplicito della persona (l'interruttore "Aiuta il
 * Genio a imparare", spento di serie), l'app manda tre chiavi prese da elenchi fissi: il tipo di sogno, la causa
 * dell'uscita di rotta, la contromisura scelta, e la sera dopo se ha aiutato. Niente account, niente id del telefono,
 * niente testo libero: solo conteggi. Le classifiche escono solo da conteggi di almeno IMPARA_MIN scelte, cosi' nessuna
 * riga racconta una persona sola. Il Genio a opzioni (gratis) li usa per mettere in cima le risposte piu' probabili per
 * quel tipo di sogno; l'agente li riceve come contesto. */

const TIPI = ["sera", "settimana", "mese", "trimestre", "anno", "rientro"] as const;
type Tipo = typeof TIPI[number];
const SOGNI = new Set(["studio", "corpo", "lavoro", "arte", "carriera", "presenza", "altro"]);
const CONTESTI = new Set(["sera", "settimana", "mese", "trimestre", "anno", "rientro"]);
/* le cause: le chiavi delle risposte pronte di revisione.js, revisioni-periodo.js e rientro-genio.js */
const TRIGGER = new Set(["app", "notifiche", "persone", "testa", "energia", "niente", "imprevisto", "stanco", "idee", "confuso", "paura",
  "difficile", "noia", "notifica", "idea", "grande", "come", "urgente", "voglia", "impegni", "altro", "automatico", "pausa", "evito",
  "messaggio", "scroll", "tempo", "fuga", "colpa", "tentazione"]);
/* le contromisure: le chiavi dei rimedi di quelle stesse schermate, piu' quelle dei piani dell'agente */
const AIUTI = new Set(["blocca", "blocco", "limite", "stanza", "elimina", "silenzio", "automatizza", "finestre", "avviso", "delega", "caveau",
  "scrivo", "respiro", "mattina", "sonno", "corto", "uguale", "alza", "notifiche", "cinque", "pezzi", "tutorial", "energia", "focus",
  "ore", "scadenza", "riparto", "niente", "altro"]);
const IMPARA_MIN = Math.max(2, Number(process.env.DREAMMAP_IMPARA_MIN || 3));

let pronto: Promise<void> | null = null;
function tabelle(): Promise<void> {
  if (!pronto) {
    pronto = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS dreammap_genio_impara (
        sogno VARCHAR(16) NOT NULL,
        contesto VARCHAR(12) NOT NULL,
        causa VARCHAR(16) NOT NULL,
        aiuto VARCHAR(16) NOT NULL DEFAULT '',
        scelte INT NOT NULL DEFAULT 0,
        aiutato INT NOT NULL DEFAULT 0,
        updatedAt DATETIME NULL,
        PRIMARY KEY (sogno, contesto, causa, aiuto)
      )`);
    })().catch((e) => { pronto = null; throw e; });
  }
  return pronto;
}

function cors(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}
function ipDi(req: Request): string {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim().slice(0, 64);
}
const finestre = new Map<string, number[]>();
function troppe(chiave: string, max: number, ms: number): boolean {
  const ora = Date.now();
  const v = (finestre.get(chiave) || []).filter((t) => ora - t < ms);
  if (v.length >= max) { finestre.set(chiave, v); return true; }
  v.push(ora); finestre.set(chiave, v);
  if (finestre.size > 20000) finestre.clear();
  return false;
}
function pulisci(t: unknown, max: number): string { return String(t ?? "").replace(/\u0000/g, "").trim().slice(0, max); }
/** Il copy che il modello sbaglia non arriva a schermo: virgolette normali, niente trattini lunghi. */
function copy(t: unknown, max: number): string {
  return String(t ?? "").replace(/[«»“”]/g, "\"").replace(/\s*[—–]\s*/g, ", ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}
function jsonDa(t: string): any { const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a < 0 || b <= a) return null; try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; } }
let CLAUDE: Anthropic | null = null;
function claude(): Anthropic { if (!CLAUDE) CLAUDE = new Anthropic({ apiKey: String(process.env.AGENT_LLM_KEY) }); return CLAUDE; }

/* ---------------------------------------------------------------------------------------
 * COSA COPRE OGNI CONVERSAZIONE. Le fasi sono le stesse del Genio a opzioni: cosi' l'app sa quali pillole mostrare.
 * --------------------------------------------------------------------------------------- */
const SCOPO: Record<Tipo, string> = {
  sera: [
    "LA REVISIONE DELLA SERA (il metodo di Davy Fogarty: il segreto e' la revisione, e per quello che ti ha interrotto non si promette piu' impegno, si cambia il sistema).",
    "Le fasi, in quest'ordine, una domanda per messaggio, seguendo quello che dice:",
    "focus: durante i blocchi di lavoro profondo di oggi era davvero concentrato? (usa le sessioni di Full Focus e il tempo sulle app)",
    "leva: ha lavorato sulle cose ad alta leva, quelle che avvicinano il sogno, o su quelle facili? (usa la priorita' di oggi e le cose chiuse)",
    "inter: cosa, di preciso, lo ha interrotto oggi? Quando lo dice, scrivi la chiave in \"trigger\".",
    "sistema: cosa cambia nel SISTEMA da domani. Qui proponi il piano su misura per quel grilletto (\"piano\").",
    "imprevisto: c'e' stato un imprevisto, o sta arrivando qualcosa che cambia i suoi piani?",
    "fine: chiudi con una frase calda e il riepilogo.",
  ].join("\n"),
  settimana: [
    "LA REVISIONE DELLA SETTIMANA. Fasi: p1 la cosa piu' importante che ha chiuso; p2 cosa l'ha portato piu' fuori strada in questi sette giorni (scrivi la chiave in \"trigger\");",
    "p3 cosa taglia dalla prossima settimana (qui proponi il piano su misura per quel grilletto); p4 la mossa della settimana prossima, una sola, con un verbo; fine.",
  ].join("\n"),
  mese: "LA REVISIONE DEL MESE. Fasi: p1 quanto e' avanzato verso la tappa dell'anno; p2 il mese in una riga; p3 cosa smette di fare da adesso (se e' un'abitudine o un'app, scrivi la chiave in \"trigger\" e proponi il piano); p4 cosa raddoppia il mese prossimo; fine.",
  trimestre: "LA REVISIONE DEL TRIMESTRE. Fasi: p1 il sogno e' ancora lo stesso; p2 il risultato piu' grande di questi tre mesi; p3 cosa cambia nel sistema per i prossimi tre mesi (proponi il piano); p4 un rischio che vede arrivare; fine.",
  anno: "LA REVISIONE DELL'ANNO. Fasi: p1 l'anno in una riga; p2 il sogno con cui e' partito e' ancora il suo; p3 cosa lascia nell'anno vecchio (proponi il piano se e' un'abitudine); p4 la promessa per l'anno nuovo, una sola; fine.",
  rientro: [
    "RIENTRA IN ROTTA: la data in cui arriva al sogno si e' spostata, e lo aiuti a rientrare come uno psicologo pratico.",
    "Fasi: prima: cosa e' successo (un imprevisto, una tentazione, niente da segnalare); grilletto: cosa c'era subito prima, il momento, cosa provava (quando lo dice, scrivi la chiave in \"trigger\");",
    "tenuto: se c'entra un'app, cosa l'ha tenuto li'; piano: proponi il piano su misura per quel grilletto; patto: scrivete insieme il patto \"Se succede..., allora io...\"; fine.",
    "Se non c'e' niente da segnalare e i dati lo confermano, chiudi subito con un incoraggiamento.",
  ].join("\n"),
};

const REGOLE = [
  "COME PARLI. Ogni risposta comincia riprendendo con parole tue quello che ha appena detto, in modo che si senta capito (per esempio \"Ho capito: alle 10 eri su Instagram per scaricare la tensione.\"). Mai la stessa apertura due volte di fila.",
  "Usa i DATI VERI della giornata: nomina le app, le fasce orarie e i minuti che trovi nei dati. Mai inventare un numero che non c'e'.",
  "Una sola domanda per messaggio, alla fine. Da 2 a 4 frasi brevi, massimo 70 parole. Dai del tu.",
  "MAI farlo sentire in colpa, mai prediche, mai \"dovresti\". Gli mostri dove sta andando e se la direzione e' ancora quella di partenza: la scelta e' sua.",
  "Italiano semplice e intero: ogni frase con il verbo e la cosa di cui parli, mai \"in quel momento\" senza dire quale. Virgolette solo \"\", mai le caporali. Mai il trattino lungo. Mai la forma \"non e' X, e' Y\". Mai gergo inglese.",
  "IL PIANO. Quando conosci il grilletto proponi UN piano su misura, detto in una o due frasi, e chiedi se lo vuole applicare. Il piano puo' essere: \"blocco\" di app in una fascia oraria (app SOLO fra i pacchetti nei dati, dalle e alle in HH:MM, giorni 7 booleani da lunedi'); \"limite\" di minuti al giorno su un'app; oppure una prevenzione senza blocco con \"azione\" fra: focus (una sessione di Full Focus con le notifiche chiuse), caveau (le idee nuove nel caveau), respiro (un respiro guidato prima del lavoro), notifiche (spegnere le notifiche di un'app), mattina (il lavoro difficile quando ha piu' energia). Il piano NON si applica da solo: l'app chiede il si' alla persona.",
  "Se la persona dice di si' al piano, non riproporlo: vai alla fase dopo.",
  "Le statistiche anonime (\"imparato\") dicono cosa capita piu' spesso e cosa ha aiutato altre persone con un sogno simile: usale solo come ispirazione, mai come fatto su di lui, e mai dire che vengono da altri utenti con nomi o numeri.",
].join("\n");

const FORMATO = [
  "Rispondi SOLO in JSON, cosi':",
  "{\"testo\":\"...\",\"fase\":\"<una delle fasi>\",\"trigger\":\"<chiave o vuoto>\",\"piano\":null oppure {\"tipo\":\"blocco|limite|prevenzione\",\"nome\":\"massimo 4 parole\",\"app\":[\"pacchetto\"],\"dalle\":\"HH:MM\",\"alle\":\"HH:MM\",\"giorni\":[true,true,true,true,true,true,true],\"minutiGiorno\":0,\"azione\":\"focus|caveau|respiro|notifiche|mattina|\",\"aiuto\":\"<chiave della contromisura>\",\"perche\":\"una riga\"},\"pillole\":[\"da 0 a 4 risposte possibili, brevi, in prima persona\"],\"fine\":false,\"riepilogo\":null}",
  "Alla fine (fine: true) \"riepilogo\" ha le risposte della persona in poche parole: {\"focus\":\"\",\"leva\":\"\",\"interruzione\":\"\",\"contromisura\":\"\",\"imprevisto\":\"\",\"patto\":\"\"} (lascia vuote quelle che non c'entrano).",
  "Metti il \"piano\" solo nel messaggio in cui lo proponi. Le \"pillole\" solo se le risposte pronte della fase non vanno bene per la tua domanda.",
].join("\n");

const USATI = new Map<string, { g: string; n: number }>();
const TETTO = Math.max(30, Number(process.env.DREAMMAP_CONVERSA_MAX_DAY || 300));

/* ---------------------------------------------------------------------------------------
 * LE STATISTICHE ANONIME, per il Genio a opzioni e per l'agente
 * --------------------------------------------------------------------------------------- */
let cacheImpara: { at: number; righe: any[] } | null = null;
async function righeImpara(): Promise<any[]> {
  if (cacheImpara && Date.now() - cacheImpara.at < 10 * 60000) return cacheImpara.righe;
  await tabelle();
  const r = await rows(sql`SELECT sogno, contesto, causa, aiuto, scelte, aiutato FROM dreammap_genio_impara WHERE scelte >= ${IMPARA_MIN} ORDER BY scelte DESC LIMIT 2000`);
  cacheImpara = { at: Date.now(), righe: r };
  return r;
}
/** Per un tipo di sogno e un contesto: le cause piu' frequenti e, per ognuna, le contromisure che hanno aiutato di piu'. */
async function classifica(sogno: string, contesto: string) {
  const r = (await righeImpara()).filter((x: any) => x.sogno === sogno && (!contesto || x.contesto === contesto || (contesto !== "rientro" && x.contesto !== "rientro")));
  const cause: Record<string, number> = {};
  const aiuti: Record<string, Record<string, { scelte: number; aiutato: number }>> = {};
  for (const x of r) {
    const c = String(x.causa), a = String(x.aiuto || "");
    if (!a) { cause[c] = (cause[c] || 0) + Number(x.scelte || 0); continue; }
    aiuti[c] = aiuti[c] || {};
    const v = aiuti[c][a] = aiuti[c][a] || { scelte: 0, aiutato: 0 };
    v.scelte += Number(x.scelte || 0); v.aiutato += Number(x.aiutato || 0);
  }
  return {
    cause: Object.keys(cause).map((k) => ({ k, n: cause[k] })).sort((a, b) => b.n - a.n).slice(0, 8),
    aiuti: Object.fromEntries(Object.keys(aiuti).map((c) => [c, Object.keys(aiuti[c]).map((k) => ({ k, scelte: aiuti[c][k].scelte, aiutato: aiuti[c][k].aiutato }))
      .sort((a, b) => (b.aiutato / Math.max(1, b.scelte) - a.aiutato / Math.max(1, a.scelte)) || b.scelte - a.scelte).slice(0, 5)])),
  };
}

export function registerFocusLockConversaRoutes(app: Express) {
  app.options("/api/focuslock/genio/impara", (_req: Request, res: Response) => { cors(res); res.status(204).end(); });

  /** POST { sogno, contesto, causa, aiuto?, esito: "scelto" | "aiutato" } -> { ok }. Pubblica: niente account, niente id. */
  app.post("/api/focuslock/genio/impara", async (req: Request, res: Response) => {
    cors(res);
    const b = req.body ?? {};
    const sogno = String(b.sogno || "altro"), contesto = String(b.contesto || ""), causa = String(b.causa || ""), aiuto = String(b.aiuto || "");
    const esito = b.esito === "aiutato" ? "aiutato" : "scelto";
    if (!SOGNI.has(sogno) || !CONTESTI.has(contesto) || !TRIGGER.has(causa) || (aiuto && !AIUTI.has(aiuto))) { res.status(400).json({ error: "chiavi non valide" }); return; }
    if (esito === "aiutato" && !aiuto) { res.status(400).json({ error: "serve la contromisura" }); return; }
    if (troppe("impara:" + ipDi(req), 40, 3600000)) { res.status(429).json({ error: "troppe richieste" }); return; }
    try {
      await tabelle();
      if (esito === "aiutato") {
        await rows(sql`INSERT INTO dreammap_genio_impara (sogno, contesto, causa, aiuto, scelte, aiutato, updatedAt) VALUES (${sogno}, ${contesto}, ${causa}, ${aiuto}, 0, 1, NOW())
          ON DUPLICATE KEY UPDATE aiutato = aiutato + 1, updatedAt = NOW()`);
      } else {
        /* la causa da sola (aiuto vuoto) conta quante volte capita; con la contromisura, quante volte e' stata scelta */
        await rows(sql`INSERT INTO dreammap_genio_impara (sogno, contesto, causa, aiuto, scelte, aiutato, updatedAt) VALUES (${sogno}, ${contesto}, ${causa}, '', 1, 0, NOW())
          ON DUPLICATE KEY UPDATE scelte = scelte + 1, updatedAt = NOW()`);
        if (aiuto) await rows(sql`INSERT INTO dreammap_genio_impara (sogno, contesto, causa, aiuto, scelte, aiutato, updatedAt) VALUES (${sogno}, ${contesto}, ${causa}, ${aiuto}, 1, 0, NOW())
          ON DUPLICATE KEY UPDATE scelte = scelte + 1, updatedAt = NOW()`);
      }
      cacheImpara = null;
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /** GET ?sogno=&contesto= -> { cause: [{k,n}], aiuti: { causa: [{k, scelte, aiutato}] } } (solo conteggi >= IMPARA_MIN) */
  app.get("/api/focuslock/genio/impara", async (req: Request, res: Response) => {
    cors(res);
    if (troppe("impara-l:" + ipDi(req), 120, 3600000)) { res.status(429).json({ error: "troppe richieste" }); return; }
    const sogno = String(req.query.sogno || "altro"), contesto = String(req.query.contesto || "");
    if (!SOGNI.has(sogno) || (contesto && !CONTESTI.has(contesto))) { res.status(400).json({ error: "chiavi non valide" }); return; }
    try { res.json(await classifica(sogno, contesto)); }
    catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* ---- LA CHAT DELLA REVISIONE E DEL RIENTRO ----
   * POST { tipo, nomeAgente, messaggi: [{ chi: "genio" | "io", t }], dati: {...}, fasi: { fase: ["risposta pronta"] },
   *        sogno } -> { testo, fase, trigger, piano, pillole, fine, riepilogo, modello } */
  app.post("/api/focuslock/agent/conversa", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    await conversaRispondi(req.body ?? {}, who.sub, res);
  });
}

type Risposta = { status: (n: number) => Risposta; json: (x: any) => any };
/** Il cuore della chat, separato dalla rotta: si prova anche senza un token Google (il controllo e' nella rotta). */
export async function conversaRispondi(b: any, sub: string, res: Risposta) {
    const tipo = (TIPI as readonly string[]).includes(String(b.tipo)) ? (String(b.tipo) as Tipo) : null;
    if (!tipo) { res.status(400).json({ error: "tipo sconosciuto" }); return; }
    const g = new Date().toISOString().slice(0, 10);
    const u = USATI.get(sub); const n = u && u.g === g ? u.n : 0;
    if (n >= TETTO) { res.status(429).json({ error: "troppi messaggi oggi" }); return; }
    USATI.set(sub, { g, n: n + 1 });
    const nome = pulisci(b.nomeAgente, 40).replace(/[<>{}\[\]`*_#|\\"]/g, "") || "Genio";
    const messaggi = (Array.isArray(b.messaggi) ? b.messaggi : []).slice(-24)
      .map((m: any) => ({ chi: m?.chi === "io" ? "io" : "genio", t: pulisci(m?.t, 1500) })).filter((m: any) => m.t);
    let dati = "{}"; try { dati = JSON.stringify(b.dati ?? {}).slice(0, 9000); } catch { dati = "{}"; }
    let fasi: Record<string, string[]> = {};
    try {
      const f = b.fasi && typeof b.fasi === "object" ? b.fasi : {};
      for (const k of Object.keys(f).slice(0, 12)) if (/^[a-z0-9]{1,16}$/i.test(k) && Array.isArray(f[k])) fasi[k] = f[k].slice(0, 8).map((x: any) => pulisci(x, 80)).filter(Boolean);
    } catch { fasi = {}; }
    const chiaviFasi = Object.keys(fasi).concat(["fine"]);
    /* i pacchetti che si possono bloccare: solo quelli che l'app ha mandato, mai uno inventato */
    const pacchetti = new Set<string>();
    try { const d = b.dati ?? {}; for (const l of [d.app, d.appTutte, d.appGiorno]) for (const a of (Array.isArray(l) ? l : [])) if (a && typeof a.pkg === "string") pacchetti.add(a.pkg); } catch { /* niente */ }
    let imparato: any = null;
    const sogno = SOGNI.has(String(b.sogno)) ? String(b.sogno) : "";
    if (sogno) { try { imparato = await classifica(sogno, tipo === "rientro" ? "rientro" : tipo); } catch { imparato = null; } }
    const turni = messaggi.filter((m: any) => m.chi === "io").length;
    const sistema = [
      `Sei ${nome === "Genio" ? "il Genio" : nome}, l'agente personale di questa persona dentro DreamMap, l'app che la porta verso il suo sogno un passo alla volta. Conosci la sua giornata dai dati che l'app ti passa.`,
      SCOPO[tipo], REGOLE,
      "Le chiavi possibili per \"trigger\": " + Array.from(TRIGGER).join(", ") + ". Per \"aiuto\": " + Array.from(AIUTI).join(", ") + ".",
      "Le fasi di questa conversazione: " + chiaviFasi.join(", ") + ". In \"fase\" scrivi la fase della domanda che stai facendo adesso.",
      "Dopo 6 risposte della persona chiudi con fine: true.",
      FORMATO,
    ].join("\n\n");
    const utenteTxt = "I DATI VERI (JSON):\n" + dati
      + "\n\nLE RISPOSTE PRONTE PER FASE (l'app le mostra come pillole):\n" + JSON.stringify(fasi)
      + (imparato ? "\n\nIMPARATO DA PERSONE CON UN SOGNO SIMILE (conteggi anonimi):\n" + JSON.stringify(imparato).slice(0, 1500) : "")
      + "\n\nLA CONVERSAZIONE FINORA:\n" + (messaggi.length ? messaggi.map((m: any) => (m.chi === "io" ? "Persona: " : "Tu: ") + m.t).join("\n") : "(comincia tu: saluta in una riga, di' cosa hai visto nei dati di piu' importante e fai la prima domanda)")
      + (b.evento === "piano_applicato" ? "\n\nLA PERSONA HA APPENA DETTO SI' AL PIANO e l'app l'ha applicato: confermalo in una riga, senza riproporlo, e passa alla fase dopo con la sua domanda." : "")
      + (b.evento === "piano_rifiutato" ? "\n\nLA PERSONA HA DETTO NO AL PIANO: rispetta la scelta in una riga, senza insistere, e passa alla fase dopo con la sua domanda." : "")
      + "\n\nRisposte della persona finora: " + turni +(turni >= 6 ? ". CHIUDI ADESSO con fine: true e il riepilogo." : ".");
    const ora = (t: unknown) => { const m = String(t ?? "").match(/^(\d{1,2})[:.](\d{2})$/); return m && +m[1] < 24 && +m[2] < 60 ? m[1].padStart(2, "0") + ":" + m[2] : ""; };
    const leggi = (t: string) => {
      const j = jsonDa(String(t || ""));
      if (!j || typeof j !== "object") return null;
      const testo = copy(j.testo, 700);
      if (!testo) return null;
      const fase = chiaviFasi.includes(String(j.fase)) ? String(j.fase) : "";
      const trigger = TRIGGER.has(String(j.trigger)) ? String(j.trigger) : "";
      let piano: any = null;
      const p = j.piano;
      if (p && typeof p === "object") {
        const tipoP = ["blocco", "limite", "prevenzione"].includes(String(p.tipo)) ? String(p.tipo) : "prevenzione";
        const app = (Array.isArray(p.app) ? p.app : []).map(String).filter((x: string) => pacchetti.has(x)).slice(0, 6);
        const dalle = ora(p.dalle), alle = ora(p.alle);
        const giorni = Array.isArray(p.giorni) && p.giorni.length === 7 ? p.giorni.map((x: any) => !!x) : [true, true, true, true, true, true, true];
        const min = Math.round(Number(p.minutiGiorno) || 0);
        const azione = ["focus", "caveau", "respiro", "notifiche", "mattina"].includes(String(p.azione)) ? String(p.azione) : "";
        const aiuto = AIUTI.has(String(p.aiuto)) ? String(p.aiuto) : (tipoP === "limite" ? "limite" : tipoP === "blocco" ? "blocco" : azione || "altro");
        const base = { nome: copy(p.nome, 40) || "Il mio piano", perche: copy(p.perche, 160), aiuto };
        if (tipoP === "blocco" && app.length && dalle && alle && dalle !== alle) piano = { ...base, tipo: "blocco", app, dalle, alle, giorni };
        else if (tipoP === "limite" && app.length && min >= 5 && min <= 600) piano = { ...base, tipo: "limite", app, minutiGiorno: min, giorni };
        else if (azione) piano = { ...base, tipo: "prevenzione", azione, app: app.slice(0, 1) };
      }
      const pillole = (Array.isArray(j.pillole) ? j.pillole : []).map((x: any) => copy(x, 70)).filter(Boolean).slice(0, 4);
      const fine = !!j.fine || turni >= 7;
      let riepilogo: any = null;
      if (fine && j.riepilogo && typeof j.riepilogo === "object") {
        riepilogo = {};
        for (const k of ["focus", "leva", "interruzione", "contromisura", "imprevisto", "patto"]) riepilogo[k] = copy(j.riepilogo[k], 200);
      }
      return { testo, fase: fine ? "fine" : fase, trigger, piano, pillole, fine, riepilogo };
    };
    const chiaveG = process.env.DREAMMAP_GEMINI_KEY || process.env.AGENT_GEMINI_KEY || "";
    try {
      if (chiaveG) {
        const modello = process.env.DREAMMAP_CONVERSA_MODELLO || process.env.DREAMMAP_RIENTRO_MODELLO || process.env.DREAMMAP_VAR_MODELLO || "gemini-3.5-flash-lite";
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modello}:generateContent`, {
          method: "POST", headers: { "x-goog-api-key": chiaveG, "content-type": "application/json" },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: sistema }] }, contents: [{ role: "user", parts: [{ text: utenteTxt }] }],
            generationConfig: { temperature: 0.6, maxOutputTokens: 900, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" } } }),
        });
        const j: any = await r.json().catch(() => ({}));
        const v = r.ok ? leggi((j?.candidates?.[0]?.content?.parts || []).map((x: any) => x.text || "").join("")) : null;
        if (v) { res.json({ ...v, modello }); return; }
      }
      if (process.env.AGENT_LLM_KEY) {
        const modello = process.env.DREAMMAP_CONVERSA_CLAUDE || process.env.DREAMMAP_RIENTRO_CLAUDE || "claude-haiku-5-5";
        const r = await claude().messages.create({ model: modello, max_tokens: 900, temperature: 0.6, system: sistema, messages: [{ role: "user", content: utenteTxt }] });
        const v = leggi(r.content.filter((x) => x.type === "text").map((x) => (x.type === "text" ? x.text : "")).join(""));
        if (v) { res.json({ ...v, modello }); return; }
      }
      if (chiaveG || process.env.AGENT_LLM_KEY) { res.status(502).json({ error: "il modello ha risposto in un modo che non si legge" }); return; }
      res.status(503).json({ error: "la conversazione non ha un modello acceso", spento: true });
    } catch (e: any) {
      res.status(502).json({ error: "conversa: " + (e?.message || String(e)) });
    }
}
