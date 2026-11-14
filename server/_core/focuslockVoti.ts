import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

/* DreamMap 0.9.357: IL VOTO ALLE RISPOSTE DEL TUO AGENTE, come su Claude (app: www/js/agente-voti.js).
 *
 * Andrea: "se l'utente mette non mi piace voglio che possa motivarlo [...] qualora tanti utenti diano lo stesso
 * feedback, l'agente personale condiviso impari; la priorita' pero' la hanno le preferenze dell'utente. E il
 * developer AI agent bug fixer deve ricevere anche lui quei feedback, e io voglio la notifica su Telegram".
 *
 * Come impara l'agente. Il modello non si riaddestra: le regole entrano nelle sue istruzioni a ogni messaggio
 * (lezioniPer, chiamata da focuslockChat.ts sia per le risposte a crediti sia per il lavoratore sul VPS).
 * 1. LE SUE PREFERENZE: le ultime segnalazioni di questa persona, con il tipo di problema e le sue parole.
 *    Valgono piu' di tutto il resto.
 * 2. DA CHI HA UN SOGNO SIMILE: lo stesso tipo di problema, segnalato negli ultimi 30 giorni da almeno 3 persone
 *    con lo stesso tipo di sogno (o da 5 in tutto), accende la regola scritta qui sotto. Le parole degli altri
 *    non entrano mai: nelle istruzioni di una persona non finiscono i dati di un'altra.
 * 3. LE REGOLE DEL REGISTA: l'agente Regista sul VPS legge i voti ogni notte e scrive regole curate
 *    (focuslock_agent_lezioni), con il segreto condiviso.
 *
 * Il VPS (regista/voti.py) scarica i voti negativi nuovi ogni 5 minuti con lo stesso segreto, li manda ad Andrea
 * su Telegram (il token del bot sta solo sul VPS) e li mette nella posta del ciclo notturno dell'agente che
 * corregge l'app. Le email degli utenti non escono mai da qui. */

type Chi = { sub: string; email?: string | null };
type Utente = (req: Request, res: Response) => Promise<Chi | null>;

/* Le stesse voci del menu dell'app, e la regola che ognuna accende quando la segnalano in tanti */
export const VOTO_CATEGORIE: Record<string, { nome: string; regola: string }> = {
  capito: { nome: "Non ha capito cosa volevo", regola: "Prima di rispondere capisci bene cosa ti chiede: se la richiesta non è chiara, fai una domanda sola invece di tirare a indovinare." },
  inventato: { nome: "Ha sbagliato o si è inventato qualcosa", regola: "Non inventare fatti, numeri, titoli, persone o funzioni dell'app: se non sei sicuro, dillo chiaramente." },
  incompleta: { nome: "Ha lasciato la risposta a metà", regola: "Chiudi ogni risposta con il passo concreto da fare adesso: niente risposte a metà." },
  lunga: { nome: "Ha scritto troppo, o in modo difficile", regola: "Rispondi corto e semplice: al massimo 6 righe, una frase per idea, parole di tutti i giorni. I dettagli solo se li chiede." },
  sogno: { nome: "Non ha tenuto conto del mio sogno", regola: "Collega ogni consiglio al suo sogno e ai dati di QUELLO CHE L'APP SA DI LUI: niente consigli generici." },
  memoria: { nome: "Ha dimenticato cosa gli avevo detto", regola: "Rileggi la conversazione prima di rispondere: non chiedere di nuovo cose che ti ha già detto." },
  rifiuto: { nome: "Si è rifiutato di aiutarmi", regola: "Aiuti sempre: l'unica cosa che non fai è spegnere o aggirare la modalità severa, i blocchi o il contratto." },
  tono: { nome: "Mi ha parlato con un tono sbagliato", regola: "Parla come un amico che crede in lui: caldo, diretto, senza prediche e senza tono da manuale." },
  app: { nome: "Un pulsante o la schermata non funziona", regola: "" },
  altro: { nome: "Altro", regola: "" },
};
const SOGNI = ["progetto", "passione", "famiglia", "corpo", "capolavoro", "voce", "fede", "coscienza", "liberta", "generico"];
const SOGLIA_STESSO_SOGNO = 3;
const SOGLIA_TUTTI = 5;
const MAX_LEZIONI_ATTIVE = 40;

async function rows(q: any): Promise<any[]> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const res: any = await db.execute(q);
  const out = Array.isArray(res) ? (Array.isArray(res[0]) ? res[0] : res) : (res?.rows ?? []);
  return Array.isArray(out) ? out.filter((r: any) => r && typeof r === "object" && !Array.isArray(r)) : [];
}

let pronte: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!pronte) {
    pronte = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_agent_voti (
        id INT AUTO_INCREMENT PRIMARY KEY,
        msgId INT NOT NULL,
        googleSub VARCHAR(64) NOT NULL,
        voto TINYINT NOT NULL,
        categoria VARCHAR(24) NULL,
        testo TEXT NULL,
        tipoSogno VARCHAR(24) NULL,
        versione VARCHAR(24) NULL,
        notificato TINYINT NOT NULL DEFAULT 0,
        createdAt TIMESTAMP NULL,
        updatedAt TIMESTAMP NULL,
        UNIQUE KEY uq_msg_utente (msgId, googleSub),
        KEY idx_notifica (notificato, voto, id),
        KEY idx_categoria (categoria, createdAt)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_agent_sogno (
        googleSub VARCHAR(64) PRIMARY KEY,
        tipo VARCHAR(24) NOT NULL,
        updatedAt TIMESTAMP NULL
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_agent_lezioni (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ambito VARCHAR(24) NOT NULL DEFAULT 'tutti',
        testo VARCHAR(600) NOT NULL,
        fonte VARCHAR(24) NOT NULL DEFAULT 'regista',
        attiva TINYINT NOT NULL DEFAULT 1,
        createdAt TIMESTAMP NULL,
        KEY idx_attiva (attiva, ambito)
      )`);
    })().catch((e) => { pronte = null; throw e; });
  }
  return pronte;
}

function checkSecret(req: Request, res: Response): boolean {
  const expected = process.env.CARE_WEBHOOK_SECRET;
  if (!expected) { res.status(503).json({ error: "CARE_WEBHOOK_SECRET not configured" }); return false; }
  if (req.headers["x-care-secret"] !== expected) { res.status(401).json({ error: "Unauthorized" }); return false; }
  return true;
}

const visti = new Map<string, number[]>();
function troppi(sub: string): boolean {
  const ora = Date.now();
  const l = (visti.get(sub) || []).filter((t) => ora - t < 3600_000);
  if (l.length >= 60) { visti.set(sub, l); return true; }
  l.push(ora); visti.set(sub, l);
  return false;
}
function categoria(x: unknown): string | null { const k = String(x ?? "").trim().toLowerCase(); return VOTO_CATEGORIE[k] ? k : null; }
function tipoSogno(x: unknown): string | null { const k = String(x ?? "").trim().toLowerCase(); return SOGNI.includes(k) ? k : null; }
function senzaEtichetta(t: unknown): string { return String(t ?? "").replace(/^\s*\[[a-z]+\]\s*/i, "").trim(); }
function giorno(d: any): string { const x = d ? new Date(d) : null; return x && !isNaN(+x) ? `${x.getDate()}/${x.getMonth() + 1}` : ""; }

/** Il tipo di sogno di questa persona (gnDati().sognoK nell'app), per le regole di chi ha un sogno simile. */
export async function salvaTipoSogno(sub: string, t: unknown): Promise<void> {
  const k = tipoSogno(t);
  if (!sub || !k) return;
  try {
    await ensure();
    await rows(sql`INSERT INTO focuslock_agent_sogno (googleSub, tipo, updatedAt) VALUES (${sub}, ${k}, NOW())
      ON DUPLICATE KEY UPDATE tipo = VALUES(tipo), updatedAt = NOW()`);
  } catch { /* un errore qui non deve fermare la chat */ }
}

let cacheTutti: { at: number; perSogno: any[]; tutti: any[] } | null = null;
async function contiDiTutti() {
  if (cacheTutti && Date.now() - cacheTutti.at < 60_000) return cacheTutti;
  const perSogno = await rows(sql`SELECT categoria, tipoSogno, COUNT(DISTINCT googleSub) AS persone FROM focuslock_agent_voti
    WHERE voto < 0 AND categoria IS NOT NULL AND createdAt >= (NOW() - INTERVAL 30 DAY) GROUP BY categoria, tipoSogno`);
  const tutti = await rows(sql`SELECT categoria, COUNT(DISTINCT googleSub) AS persone FROM focuslock_agent_voti
    WHERE voto < 0 AND categoria IS NOT NULL AND createdAt >= (NOW() - INTERVAL 30 DAY) GROUP BY categoria`);
  cacheTutti = { at: Date.now(), perSogno, tutti };
  return cacheTutti;
}

/** Il blocco da mettere nelle istruzioni dell'agente di questa persona. Vuoto se non c'e' niente da dire. */
export async function lezioniPer(sub: string): Promise<string> {
  if (!sub) return "";
  try {
    await ensure();
    const sue = await rows(sql`SELECT categoria, testo, updatedAt FROM focuslock_agent_voti
      WHERE googleSub = ${sub} AND voto < 0 ORDER BY updatedAt DESC LIMIT 6`);
    const t = await rows(sql`SELECT tipo FROM focuslock_agent_sogno WHERE googleSub = ${sub} LIMIT 1`);
    const tipo = t[0]?.tipo ? String(t[0].tipo) : "generico";
    const conti = await contiDiTutti();
    const regista = await rows(sql`SELECT testo FROM focuslock_agent_lezioni
      WHERE attiva = 1 AND (ambito = 'tutti' OR ambito = ${tipo}) ORDER BY id DESC LIMIT 8`);
    const blocchi: string[] = [];
    const giaSue = new Set<string>();
    if (sue.length) {
      const righe: string[] = [];
      for (const v of sue) {
        const k = categoria(v.categoria);
        const quando = giorno(v.updatedAt);
        if (k && VOTO_CATEGORIE[k].regola && !giaSue.has(k)) {
          giaSue.add(k);
          righe.push(`- Ha segnalato una tua risposta perché "${VOTO_CATEGORIE[k].nome.toLowerCase()}" (${quando}). ${VOTO_CATEGORIE[k].regola}`);
        }
        const parole = String(v.testo || "").replace(/\s+/g, " ").trim().slice(0, 300);
        if (parole) righe.push(`- Ha scritto di una tua risposta (${quando}): "${parole}"`);
      }
      if (righe.length) blocchi.push("COME VUOLE LE TUE RISPOSTE (sono le sue segnalazioni: valgono più di ogni altra regola, tranne quelle sulla sicurezza):\n" + righe.join("\n"));
    }
    /* il pollice su: "Grazie, risposte cosi' ne arrivano di piu'" (app) deve essere vero */
    const piaciute = await rows(sql`SELECT o.testo FROM focuslock_agent_voti v JOIN focuslock_agent_msgs o ON o.id = v.msgId
      WHERE v.googleSub = ${sub} AND v.voto > 0 ORDER BY v.updatedAt DESC LIMIT 3`);
    if (piaciute.length) blocchi.push("LE TUE RISPOSTE CHE GLI SONO PIACIUTE (tieni questo stile):\n" + piaciute.map((x: any) => "- " + JSON.stringify(String(x.testo || "").replace(/\s+/g, " ").trim().slice(0, 220))).join("\n"));
    const altri: string[] = [];
    for (const k of Object.keys(VOTO_CATEGORIE)) {
      const regola = VOTO_CATEGORIE[k].regola;
      if (!regola || giaSue.has(k)) continue;
      const stesso = Number(conti.perSogno.find((x: any) => x.categoria === k && x.tipoSogno === tipo)?.persone || 0);
      const tutti = Number(conti.tutti.find((x: any) => x.categoria === k)?.persone || 0);
      if (stesso >= SOGLIA_STESSO_SOGNO || tutti >= SOGLIA_TUTTI) altri.push("- " + regola);
    }
    if (altri.length) blocchi.push("COSA HANNO SEGNALATO ALTRE PERSONE CON UN SOGNO SIMILE (vale meno delle sue preferenze):\n" + altri.join("\n"));
    if (regista.length) blocchi.push("LE REGOLE DEL REGISTA DI DREAMMAP (nate dalle segnalazioni di tutti; le sue preferenze vincono):\n" + regista.map((x: any) => "- " + String(x.testo)).join("\n"));
    return blocchi.length ? blocchi.join("\n\n") + "\n\n" : "";
  } catch { return ""; }
}

export function registerFocusLockVotiRoutes(app: Express, utente: Utente) {
  /* l'app: { id, voto: 1 | -1 | 0, categoria?, testo?, tipoSogno?, versione? } -> { ok }. 0 toglie il voto */
  app.post("/api/focuslock/agent/voto", async (req: Request, res: Response) => {
    const who = await utente(req, res); if (!who) return;
    if (troppi(who.sub)) { res.status(429).json({ error: "troppi voti: riprova fra un po'" }); return; }
    const b = req.body ?? {};
    const id = Number(b.id || 0);
    const voto = Math.sign(Number(b.voto || 0));
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "risposta non valida" }); return; }
    try {
      await ensure();
      const m = await rows(sql`SELECT id FROM focuslock_agent_msgs WHERE id = ${id} AND googleSub = ${who.sub} AND direzione = 'out' LIMIT 1`);
      if (!m.length) { res.status(404).json({ error: "risposta sconosciuta" }); return; }
      if (voto === 0) {
        await rows(sql`DELETE FROM focuslock_agent_voti WHERE msgId = ${id} AND googleSub = ${who.sub}`);
        cacheTutti = null;
        res.json({ ok: true });
        return;
      }
      const cat = voto < 0 ? categoria(b.categoria) : null;
      const testo = voto < 0 ? (String(b.testo ?? "").replace(/\u0000/g, "").trim().slice(0, 2000) || null) : null;
      const tipo = tipoSogno(b.tipoSogno);
      const versione = String(b.versione ?? "").replace(/[^0-9a-z.\-]/gi, "").slice(0, 24) || null;
      const notificato = voto < 0 ? 0 : 1;   // ad Andrea arrivano i "non mi piace" (anche quando la persona li riscrive)
      await rows(sql`INSERT INTO focuslock_agent_voti (msgId, googleSub, voto, categoria, testo, tipoSogno, versione, notificato, createdAt, updatedAt)
        VALUES (${id}, ${who.sub}, ${voto}, ${cat}, ${testo}, ${tipo}, ${versione}, ${notificato}, NOW(), NOW())
        ON DUPLICATE KEY UPDATE notificato = VALUES(notificato), voto = VALUES(voto), categoria = VALUES(categoria), testo = VALUES(testo),
          tipoSogno = COALESCE(VALUES(tipoSogno), tipoSogno), versione = COALESCE(VALUES(versione), versione), updatedAt = NOW()`);
      if (tipo) salvaTipoSogno(who.sub, tipo);
      cacheTutti = null;
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* ---- il VPS, con il segreto ---- */
  /* i "non mi piace" non ancora mandati ad Andrea, con la domanda e la risposta (mai l'email) */
  app.get("/api/focuslock/agent/voti/nuovi", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      await ensure();
      const l = await rows(sql`SELECT v.id, v.categoria, v.testo, v.tipoSogno, v.versione, v.updatedAt,
          o.testo AS risposta, i.testo AS domanda
        FROM focuslock_agent_voti v
        JOIN focuslock_agent_msgs o ON o.id = v.msgId
        LEFT JOIN focuslock_agent_msgs i ON i.id = o.inReplyTo
        WHERE v.voto < 0 AND v.notificato = 0 ORDER BY v.id ASC LIMIT 20`);
      const conti = l.length ? await contiDiTutti() : { tutti: [] as any[] };
      res.json({
        voti: l.map((v: any) => ({
          id: Number(v.id),
          categoria: v.categoria || null,
          problema: v.categoria && VOTO_CATEGORIE[v.categoria] ? VOTO_CATEGORIE[v.categoria].nome : null,
          testo: String(v.testo || ""),
          tipoSogno: v.tipoSogno || null,
          versione: v.versione || null,
          domanda: senzaEtichetta(v.domanda).slice(0, 600),
          risposta: String(v.risposta || "").slice(0, 1200),
          persone30: v.categoria ? Number(conti.tutti.find((x: any) => x.categoria === v.categoria)?.persone || 0) : 0,
          at: v.updatedAt ? new Date(v.updatedAt).getTime() : 0,
        })),
      });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });
  app.post("/api/focuslock/agent/voti/notificati", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    const ids = (Array.isArray((req.body ?? {}).ids) ? req.body.ids : []).map((x: unknown) => Number(x)).filter((x: number) => Number.isInteger(x) && x > 0).slice(0, 50);
    try {
      await ensure();
      for (const id of ids) await rows(sql`UPDATE focuslock_agent_voti SET notificato = 1 WHERE id = ${id}`);
      res.json({ ok: true, segnati: ids.length });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });
  /* i "non mi piace" della chat del Genio (tabella dei voti di sempre, focuslockArena.ts), dopo l'ultimo gia' visto dal VPS */
  app.get("/api/focuslock/agent/voti/genio", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    const dopo = Math.max(0, Number(req.query.dopo || 0) || 0);
    try {
      const l = await rows(sql`SELECT id, modo, testo, createdAt FROM focuslock_voti_chat WHERE id > ${dopo} AND voto < 0 ORDER BY id ASC LIMIT 30`);
      res.json({ voti: l.map((v: any) => ({ id: Number(v.id), modo: String(v.modo || ""), testo: String(v.testo || ""), at: v.createdAt ? new Date(v.createdAt).getTime() : 0 })) });
    } catch (e: any) {
      if (/doesn't exist|no such table/i.test(String(e?.message || ""))) { res.json({ voti: [] }); return; }
      res.status(500).json({ error: "db: " + (e?.message || String(e)) });
    }
  });
  /* il quadro degli ultimi 30 giorni per il Regista: problemi per tipo e per sogno, le ultime parole, le regole attive */
  app.get("/api/focuslock/agent/voti/riepilogo", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      await ensure();
      const categorie = await rows(sql`SELECT categoria, COUNT(*) AS voti, COUNT(DISTINCT googleSub) AS persone FROM focuslock_agent_voti
        WHERE voto < 0 AND createdAt >= (NOW() - INTERVAL 30 DAY) GROUP BY categoria ORDER BY persone DESC`);
      const sogni = await rows(sql`SELECT tipoSogno, categoria, COUNT(DISTINCT googleSub) AS persone FROM focuslock_agent_voti
        WHERE voto < 0 AND createdAt >= (NOW() - INTERVAL 30 DAY) GROUP BY tipoSogno, categoria ORDER BY persone DESC LIMIT 60`);
      const pos = await rows(sql`SELECT COUNT(*) AS n, COUNT(DISTINCT googleSub) AS persone FROM focuslock_agent_voti WHERE voto > 0 AND createdAt >= (NOW() - INTERVAL 30 DAY)`);
      const ultimi = await rows(sql`SELECT categoria, testo, tipoSogno, versione, updatedAt FROM focuslock_agent_voti
        WHERE voto < 0 ORDER BY updatedAt DESC LIMIT 25`);
      const lezioni = await rows(sql`SELECT id, ambito, testo, fonte, attiva, createdAt FROM focuslock_agent_lezioni ORDER BY id DESC LIMIT 60`);
      res.json({
        giorni: 30,
        categorie: categorie.map((c: any) => ({ categoria: c.categoria || null, problema: c.categoria && VOTO_CATEGORIE[c.categoria] ? VOTO_CATEGORIE[c.categoria].nome : "Senza tipo", voti: Number(c.voti), persone: Number(c.persone) })),
        perSogno: sogni.map((s: any) => ({ tipoSogno: s.tipoSogno || null, categoria: s.categoria || null, persone: Number(s.persone) })),
        positivi: { voti: Number(pos[0]?.n || 0), persone: Number(pos[0]?.persone || 0) },
        ultimi: ultimi.map((u: any) => ({ categoria: u.categoria || null, testo: String(u.testo || "").slice(0, 400), tipoSogno: u.tipoSogno || null, versione: u.versione || null, at: u.updatedAt ? new Date(u.updatedAt).getTime() : 0 })),
        lezioni: lezioni.map((x: any) => ({ id: Number(x.id), ambito: x.ambito, testo: x.testo, fonte: x.fonte, attiva: Number(x.attiva) === 1, at: x.createdAt ? new Date(x.createdAt).getTime() : 0 })),
        soglie: { stessoSogno: SOGLIA_STESSO_SOGNO, tutti: SOGLIA_TUTTI },
      });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });
  /* il Regista scrive una regola per l'agente di tutti (ambito "tutti") o di chi ha un tipo di sogno */
  app.post("/api/focuslock/agent/lezioni", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    const b = req.body ?? {};
    const ambito = String(b.ambito || "tutti").trim().toLowerCase();
    if (ambito !== "tutti" && !SOGNI.includes(ambito)) { res.status(400).json({ error: "ambito: tutti oppure " + SOGNI.join(", ") }); return; }
    const testo = String(b.testo ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
    if (testo.length < 10 || testo.length > 500) { res.status(400).json({ error: "la regola va da 10 a 500 caratteri" }); return; }
    const fonte = String(b.fonte || "regista").replace(/[^a-z-]/gi, "").slice(0, 24) || "regista";
    try {
      await ensure();
      const doppia = await rows(sql`SELECT id FROM focuslock_agent_lezioni WHERE attiva = 1 AND ambito = ${ambito} AND testo = ${testo} LIMIT 1`);
      if (doppia.length) { res.json({ ok: true, id: Number(doppia[0].id), gia: true }); return; }
      await rows(sql`INSERT INTO focuslock_agent_lezioni (ambito, testo, fonte, attiva, createdAt) VALUES (${ambito}, ${testo}, ${fonte}, 1, NOW())`);
      const r = await rows(sql`SELECT LAST_INSERT_ID() AS id`);
      /* le regole attive restano poche: le piu' vecchie si spengono (non si cancellano) */
      const attive = await rows(sql`SELECT id FROM focuslock_agent_lezioni WHERE attiva = 1 ORDER BY id DESC`);
      for (const x of attive.slice(MAX_LEZIONI_ATTIVE)) await rows(sql`UPDATE focuslock_agent_lezioni SET attiva = 0 WHERE id = ${Number(x.id)}`);
      res.json({ ok: true, id: Number(r[0]?.id || 0) });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });
  app.post("/api/focuslock/agent/lezioni/:id/spegni", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "regola non valida" }); return; }
    try {
      await ensure();
      await rows(sql`UPDATE focuslock_agent_lezioni SET attiva = 0 WHERE id = ${id}`);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });
}
