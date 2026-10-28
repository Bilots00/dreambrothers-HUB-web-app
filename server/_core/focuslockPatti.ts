import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { rows } from "./focuslockSocial";
import { whoIs, isIdentity } from "./focuslockRoutes";

/* FocusLock / DreamMap — IL PATTO CON IL TUO DREAMBROTHER (app 0.9.285).
 *
 * Andrea: "il contratto di abitudine con il proprio Dreambrother, con un deterrente economico: dare
 * soldi a una persona firmando un contratto con lei, cosi' l'automazione lavora per loro e il garante
 * non deve mai sorvegliare ATTIVAMENTE ne' ricordarsi di chiedere: i soldi gli arrivano da soli".
 * Per ora niente penitenze analogiche: solo il contratto e i soldi.
 *
 * IL GIRO
 *  1. Chi si impegna scrive il patto nell'app: l'abitudine (con la formula di Atomic Habits: dopo
 *     cosa, dove, la versione da due minuti), come la verifica l'app (una sessione di Full Focus,
 *     il tempo sul telefono, un passo della roadmap, una riga del foglio, una sessione in coppia),
 *     i giorni, l'ora entro cui va fatta, quanto paga per ogni giorno mancato, il tetto del mese.
 *  2. Il garante (il Dreambrother) riceve il codice e firma. Da li' il patto e' attivo.
 *  3. Ogni giorno il telefono di chi si impegna controlla da solo e manda il verdetto. Se un giorno
 *     passa senza verdetto (telefono spento, app tolta), dopo 24 ore il server lo segna "nessun dato"
 *     e dopo altre 48 ore vale come mancato: niente scuse, niente da ricordare.
 *  4. Un giorno mancato: i soldi partono da soli verso il garante (Stripe Connect: la carta di chi si
 *     impegna, il conto del garante), e tutti e due lo vedono nell'app.
 *
 * I SOLDI. Spenti finche' su Railway non c'e' STRIPE_SECRET_KEY (decide Andrea). Senza, il patto
 * funziona uguale e ogni giorno mancato resta scritto come "da pagare". Costi (stripe.com/it/connect/
 * pricing, ottobre 2026): carta europea 1,5% + 0,25 EUR; conto del garante 2 EUR nei mesi in cui
 * riceve soldi, piu' 0,25% + 0,10 EUR per bonifico. Paga la piattaforma: al garante arriva la posta intera.
 */

const GIORNO_IT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
export function giornoDi(ms: number): string { return GIORNO_IT.format(new Date(ms)); }
const GRAZIA_MS = 24 * 3600_000;            // dopo la scadenza: un giorno per mandare il verdetto
const NESSUNDATO_VALE_MS = 48 * 3600_000;   // poi "nessun dato" vale come mancato
/* 0.9.302: "contratto" = nessuno sgarro al contratto di abitudine in quel giorno (lo decide il telefono, Contratto.java) */
export const VERIFICHE = ["sessione", "schermo", "passo", "riga", "coppia", "contratto"];

let ready: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await rows(sql`CREATE TABLE IF NOT EXISTS focuslock_patti (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codice VARCHAR(12) NOT NULL,
        autoreSub VARCHAR(64) NOT NULL,
        autoreNome VARCHAR(60) NULL,
        autoreEmail VARCHAR(160) NULL,
        garanteSub VARCHAR(64) NULL,
        garanteNome VARCHAR(60) NULL,
        garanteEmail VARCHAR(160) NULL,
        abitudine TEXT NOT NULL,
        posta INT NOT NULL,
        tetto INT NOT NULL,
        daGiorno VARCHAR(10) NOT NULL,
        aGiorno VARCHAR(10) NOT NULL,
        stato VARCHAR(12) NOT NULL,
        firmatoAt TIMESTAMP NULL,
        stripeCliente VARCHAR(64) NULL,
        stripeMetodo VARCHAR(64) NULL,
        stripeSessione VARCHAR(80) NULL,
        stripeConto VARCHAR(64) NULL,
        createdAt TIMESTAMP NULL,
        UNIQUE KEY (codice),
        INDEX (autoreSub), INDEX (garanteSub), INDEX (stato)
      )`);
      await rows(sql`CREATE TABLE IF NOT EXISTS focuslock_patti_giorni (
        pattoId INT NOT NULL,
        giorno VARCHAR(10) NOT NULL,
        esito VARCHAR(12) NOT NULL,
        dettaglio VARCHAR(300) NULL,
        importo INT NOT NULL DEFAULT 0,
        pagamento VARCHAR(80) NULL,
        statoPagamento VARCHAR(24) NULL,
        at TIMESTAMP NULL,
        PRIMARY KEY (pattoId, giorno)
      )`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/* ---------------------------------------------------------------------------------------
   LE REGOLE, senza database (focuslockPatti.test.ts)
   --------------------------------------------------------------------------------------- */
/* 0.9.302: la destinazione dei soldi. Di serie l'amico che fa da garante; "beneficenza" = un ente scritto da chi si
   impegna, senza garante (il patto e' attivo subito) e senza addebiti finche' non c'e' un modo vero di donare. */
export type Destinazione = { tipo: "amico" | "beneficenza"; ente?: string };
export type Abitudine = { cosa: string; dopoDi?: string; dove?: string; dueMinuti?: string; giorni: boolean[]; entro: string; verifica: { tipo: string; minuti?: number; ore?: number; parole?: string[] }; destinazione?: Destinazione };
/** I giorni in cui l'abitudine va fatta, da daGiorno a fino (compreso). giorni: 7 valori da lunedi'. */
export function giorniPrevisti(ab: Abitudine, daGiorno: string, fino: string): string[] {
  const out: string[] = [];
  const d = new Date(daGiorno + "T12:00:00Z");
  for (let i = 0; i < 400; i++) {
    const k = d.toISOString().slice(0, 10);
    if (k > fino) break;
    const lun0 = (d.getUTCDay() + 6) % 7;
    if (ab.giorni[lun0]) out.push(k);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
/** La scadenza di un giorno, in ms: l'ora "entro" di quel giorno all'ora italiana (circa: +1 o +2). */
export function scadenza(giorno: string, entro: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(entro || "") || ["", "23", "59"];
  const base = Date.parse(giorno + "T" + String(m[1]).padStart(2, "0") + ":" + m[2] + ":00Z");
  /* l'ora italiana: si prova +1 e +2 e si tiene quella che, riletta a Roma, da' lo stesso giorno e la stessa ora */
  for (const off of [1, 2]) {
    const t = base - off * 3600_000;
    const s = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
    if (s === String(m[1]).padStart(2, "0") + ":" + m[2] && giornoDi(t) === giorno) return t;
  }
  return base - 3600_000;
}
/** Quanto si paga per un giorno mancato, senza superare il tetto del mese (centesimi). */
export function importoGiorno(posta: number, tetto: number, giaNelMese: number): number {
  return Math.max(0, Math.min(posta, tetto - giaNelMese));
}
export function abitudineValida(x: any): Abitudine | null {
  if (!x || typeof x !== "object") return null;
  const cosa = String(x.cosa || "").trim().slice(0, 160);
  const giorni = Array.isArray(x.giorni) && x.giorni.length === 7 ? x.giorni.map((g: any) => !!g) : null;
  const tipo = String(x.verifica?.tipo || "");
  if (!cosa || !giorni || !giorni.some(Boolean) || !VERIFICHE.includes(tipo)) return null;
  const entro = /^\d{1,2}:\d{2}$/.test(String(x.entro || "")) ? String(x.entro) : "23:59";
  const ente = String(x.destinazione?.ente || "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const destinazione: Destinazione | undefined = x.destinazione?.tipo === "beneficenza" ? (ente ? { tipo: "beneficenza", ente } : undefined) : undefined;
  if (x.destinazione?.tipo === "beneficenza" && !destinazione) return null;
  return {
    cosa, giorni, entro, ...(destinazione ? { destinazione } : {}),
    dopoDi: String(x.dopoDi || "").trim().slice(0, 120), dove: String(x.dove || "").trim().slice(0, 80), dueMinuti: String(x.dueMinuti || "").trim().slice(0, 120),
    verifica: { tipo, minuti: Math.max(0, Math.min(600, Number(x.verifica?.minuti) || 0)), ore: Math.max(0, Math.min(24, Number(x.verifica?.ore) || 0)),
      parole: (Array.isArray(x.verifica?.parole) ? x.verifica.parole : []).map((p: any) => String(p || "").trim().toLowerCase()).filter(Boolean).slice(0, 5) },
  };
}

/* ---------------------------------------------------------------------------------------
   STRIPE (spento senza STRIPE_SECRET_KEY): una chiamata REST, senza libreria
   --------------------------------------------------------------------------------------- */
function stripeAcceso(): boolean { return !!process.env.STRIPE_SECRET_KEY; }
async function stripe(path: string, params: Record<string, any> = {}, method: "POST" | "GET" = "POST"): Promise<any> {
  const key = process.env.STRIPE_SECRET_KEY; if (!key) throw new Error("pagamenti spenti");
  const body = new URLSearchParams();
  const add = (k: string, v: any) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) { v.forEach((x, i) => add(`${k}[${i}]`, x)); return; }
    if (typeof v === "object") { for (const [kk, vv] of Object.entries(v)) add(`${k}[${kk}]`, vv); return; }
    body.append(k, String(v));
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  const url = "https://api.stripe.com/v1/" + path + (method === "GET" && body.toString() ? "?" + body.toString() : "");
  const r = await fetch(url, { method, headers: { authorization: "Bearer " + key, ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}) }, body: method === "POST" ? body.toString() : undefined });
  const j: any = await r.json();
  if (!r.ok) throw new Error(String(j?.error?.message || "stripe " + r.status));
  return j;
}
const BASE = () => String(process.env.PUBLIC_BASE_URL || "https://meta-ai-media-buyer-production.up.railway.app").replace(/\/+$/, "");

export function perBeneficenza(p: any): boolean {
  try { return JSON.parse(String(p?.abitudine || "{}"))?.destinazione?.tipo === "beneficenza"; } catch { return false; }
}
/** L'addebito di un giorno mancato: dalla carta di chi si impegna al conto del garante. */
async function addebita(p: any, giorno: string, importo: number): Promise<{ id: string; stato: string }> {
  /* 0.9.302: verso un ente non c'e' ancora nessun modo vero di mandare i soldi: l'impegno resta scritto, senza addebito */
  if (perBeneficenza(p)) return { id: "", stato: "da_donare" };
  if (!stripeAcceso()) return { id: "", stato: "da_collegare" };
  if (!p.stripeCliente || !p.stripeMetodo) return { id: "", stato: "manca_carta" };
  if (!p.stripeConto) return { id: "", stato: "manca_conto" };
  try {
    const pi = await stripe("payment_intents", {
      amount: importo, currency: "eur", customer: p.stripeCliente, payment_method: p.stripeMetodo, off_session: true, confirm: true,
      transfer_data: { destination: p.stripeConto },
      description: `Patto con ${p.garanteNome || "il tuo garante"}: giorno mancato ${giorno}`,
      metadata: { patto: String(p.id), giorno },
    });
    return { id: String(pi.id), stato: pi.status === "succeeded" ? "inviato" : String(pi.status || "in_corso").slice(0, 24) };
  } catch (e: any) {
    return { id: "", stato: ("errore: " + String(e?.message || e)).slice(0, 24) };
  }
}

/* ---------------------------------------------------------------------------------------
   IL CONTROLLO DEL SERVER: i giorni senza verdetto, e i soldi ancora da mandare
   --------------------------------------------------------------------------------------- */
async function giaNelMese(pattoId: number, giorno: string): Promise<number> {
  const r = await rows(sql`SELECT COALESCE(SUM(importo), 0) AS t FROM focuslock_patti_giorni WHERE pattoId = ${pattoId} AND giorno LIKE ${giorno.slice(0, 7) + "%"} AND giorno <> ${giorno}`);
  return Number(r[0]?.t || 0);
}
export async function controllaPatti(adesso = Date.now()): Promise<number> {
  await ensureTables();
  const attivi = await rows(sql`SELECT * FROM focuslock_patti WHERE stato = 'attivo' LIMIT 500`);
  let fatti = 0;
  for (const p of attivi) {
    let ab: Abitudine | null = null; try { ab = JSON.parse(p.abitudine); } catch { ab = null; }
    if (!ab) continue;
    const oggi = giornoDi(adesso);
    const fino = String(p.aGiorno) < oggi ? String(p.aGiorno) : oggi;
    const scritti = await rows(sql`SELECT giorno, esito, importo, statoPagamento, at FROM focuslock_patti_giorni WHERE pattoId = ${p.id}`);
    const per = new Map(scritti.map((s: any) => [String(s.giorno), s]));
    for (const g of giorniPrevisti(ab, String(p.daGiorno), fino)) {
      const s: any = per.get(g);
      const sc = scadenza(g, ab.entro);
      if (!s) {
        if (adesso - sc < GRAZIA_MS) continue;
        await rows(sql`INSERT IGNORE INTO focuslock_patti_giorni (pattoId, giorno, esito, dettaglio, importo, at) VALUES (${p.id}, ${g}, 'nessundato', 'Nessun dato dal telefono entro un giorno', 0, NOW())`);
        fatti++;
        continue;
      }
      /* "nessun dato" che resta tale per altre 48 ore vale come mancato */
      if (s.esito === "nessundato" && adesso - sc >= GRAZIA_MS + NESSUNDATO_VALE_MS) {
        const imp = importoGiorno(Number(p.posta), Number(p.tetto), await giaNelMese(Number(p.id), g));
        const pag = imp > 0 ? await addebita(p, g, imp) : { id: "", stato: "tetto" };
        await rows(sql`UPDATE focuslock_patti_giorni SET esito = 'mancato', importo = ${imp}, pagamento = ${pag.id || null}, statoPagamento = ${pag.stato}, at = NOW() WHERE pattoId = ${p.id} AND giorno = ${g} AND esito = 'nessundato'`);
        fatti++;
        continue;
      }
      /* un mancato rimasto da pagare (carta o conto collegati dopo): ci si riprova */
      if (s.esito === "mancato" && Number(s.importo) > 0 && ["da_collegare", "manca_carta", "manca_conto"].includes(String(s.statoPagamento || "")) && stripeAcceso() && p.stripeMetodo && p.stripeConto) {
        const pag = await addebita(p, g, Number(s.importo));
        await rows(sql`UPDATE focuslock_patti_giorni SET pagamento = ${pag.id || null}, statoPagamento = ${pag.stato} WHERE pattoId = ${p.id} AND giorno = ${g}`);
        fatti++;
      }
    }
    if (String(p.aGiorno) < giornoDi(adesso - GRAZIA_MS - NESSUNDATO_VALE_MS)) await rows(sql`UPDATE focuslock_patti SET stato = 'finito' WHERE id = ${p.id} AND stato = 'attivo'`);
  }
  return fatti;
}

/* ---------------------------------------------------------------------------------------
   CHI SEI (il tesserino di Google, ricordato dieci minuti)
   --------------------------------------------------------------------------------------- */
const TESSERE = new Map<string, { sub: string; email: string | null; name: string | null; at: number }>();
async function chi(req: Request, res: Response) {
  const h = String(req.headers["authorization"] || "");
  const k = createHash("sha256").update(h).digest("hex");
  const c = TESSERE.get(k);
  if (c && Date.now() - c.at < 10 * 60_000) return c;
  const w = await whoIs(req);
  if (!isIdentity(w)) { res.status((w as any).status || 401).json({ error: (w as any).error || "unauthorized" }); return null; }
  const v = { sub: w.sub, email: w.email, name: w.name, at: Date.now() };
  TESSERE.set(k, v);
  if (TESSERE.size > 2000) { const via: string[] = []; TESSERE.forEach((y, x) => { if (Date.now() - y.at > 10 * 60_000) via.push(x); }); via.forEach((x) => TESSERE.delete(x)); }
  return v;
}
const pulisci = (t: unknown, n: number) => String(t ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

async function vistaPatto(p: any, sub: string) {
  const giorni = await rows(sql`SELECT giorno, esito, dettaglio, importo, statoPagamento FROM focuslock_patti_giorni WHERE pattoId = ${p.id} ORDER BY giorno DESC LIMIT 120`);
  let ab: any = null; try { ab = JSON.parse(p.abitudine); } catch { ab = null; }
  const pagati = giorni.filter((g: any) => g.statoPagamento === "inviato").reduce((a: number, g: any) => a + Number(g.importo || 0), 0);
  const dovuti = giorni.filter((g: any) => g.esito === "mancato").reduce((a: number, g: any) => a + Number(g.importo || 0), 0);
  return {
    id: Number(p.id), codice: p.codice, ruolo: p.autoreSub === sub ? "autore" : "garante",
    autore: p.autoreNome || "Chi si impegna", garante: p.garanteNome || null, firmato: !!p.garanteSub,
    abitudine: ab, posta: Number(p.posta), tetto: Number(p.tetto), daGiorno: p.daGiorno, aGiorno: p.aGiorno, stato: p.stato,
    destinazione: ab?.destinazione?.tipo === "beneficenza" ? { tipo: "beneficenza", ente: String(ab.destinazione.ente || "") } : { tipo: "amico" },
    pagamenti: { acceso: stripeAcceso(), carta: !!p.stripeMetodo, conto: !!p.stripeConto },
    giorni: giorni.map((g: any) => ({ giorno: g.giorno, esito: g.esito, dettaglio: g.dettaglio || "", importo: Number(g.importo || 0), statoPagamento: g.statoPagamento || null })),
    totali: { mancati: giorni.filter((g: any) => g.esito === "mancato").length, rispettati: giorni.filter((g: any) => g.esito === "rispettato").length, inviati: pagati, dovuti },
  };
}

export function registerFocusLockPattiRoutes(app: Express) {
  /* il controllo del server: ogni venti minuti, i giorni senza verdetto e i soldi da mandare */
  setInterval(() => { controllaPatti().catch(() => { /* il prossimo giro ci riprova */ }); }, 20 * 60_000);

  /* un patto nuovo: { abitudine, posta (euro), tetto (euro al mese), durataGiorni, garanteNome, nome }
     0.9.302: con abitudine.destinazione = { tipo: "beneficenza", ente } non c'e' garante: il patto e' attivo da domani */
  app.post("/api/focuslock/patti", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const b = req.body || {};
    const ab = abitudineValida(b.abitudine);
    if (!ab) { res.status(400).json({ error: "abitudine non valida: serve cosa, almeno un giorno e come la verifica l'app" }); return; }
    const posta = Math.round(Math.max(1, Math.min(100, Number(b.posta) || 5)) * 100);
    const tetto = Math.round(Math.max(Number(b.posta) || 5, Math.min(500, Number(b.tetto) || 50)) * 100);
    const durata = Math.max(7, Math.min(180, Math.round(Number(b.durataGiorni) || 30)));
    const da = new Date(Date.now() + 86400_000);       // si comincia domani: oggi si firma
    const daGiorno = giornoDi(da.getTime()), aGiorno = giornoDi(da.getTime() + (durata - 1) * 86400_000);
    try {
      await ensureTables();
      const codice = randomBytes(6).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() + String(Date.now() % 100).padStart(2, "0");
      const benef = ab.destinazione?.tipo === "beneficenza";
      await rows(sql`INSERT INTO focuslock_patti (codice, autoreSub, autoreNome, autoreEmail, garanteNome, abitudine, posta, tetto, daGiorno, aGiorno, stato, createdAt)
        VALUES (${codice}, ${who.sub}, ${pulisci(b.nome || who.name || "", 60) || null}, ${who.email}, ${benef ? pulisci(ab.destinazione?.ente, 60) : (pulisci(b.garanteNome, 60) || null)}, ${JSON.stringify(ab)}, ${posta}, ${tetto}, ${daGiorno}, ${aGiorno}, ${benef ? "attivo" : "attesa"}, NOW())`);
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE codice = ${codice} LIMIT 1`);
      res.json({ patto: await vistaPatto(p[0], who.sub) });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* i miei patti: quelli in cui mi impegno e quelli in cui faccio da garante */
  app.get("/api/focuslock/patti", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    try {
      await ensureTables();
      const l = await rows(sql`SELECT * FROM focuslock_patti WHERE (autoreSub = ${who.sub} OR garanteSub = ${who.sub}) AND stato <> 'annullato' ORDER BY id DESC LIMIT 30`);
      const out = [];
      for (const p of l) out.push(await vistaPatto(p, who.sub));
      res.json({ patti: out, pagamenti: stripeAcceso() });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* il garante legge il patto prima di firmarlo */
  app.get("/api/focuslock/patti/codice/:codice", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    try {
      await ensureTables();
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE codice = ${String(req.params.codice || "").toUpperCase().slice(0, 12)} LIMIT 1`);
      if (!p.length || p[0].stato === "annullato") { res.status(404).json({ error: "patto non trovato" }); return; }
      if (p[0].autoreSub === who.sub) { res.status(409).json({ error: "questo e' il tuo patto: il garante deve essere un'altra persona" }); return; }
      if (perBeneficenza(p[0])) { res.status(404).json({ error: "patto non trovato" }); return; }
      res.json({ patto: await vistaPatto(p[0], who.sub) });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* il garante firma: da li' il patto e' attivo */
  app.post("/api/focuslock/patti/firma", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const b = req.body || {};
    try {
      await ensureTables();
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE codice = ${String(b.codice || "").toUpperCase().slice(0, 12)} LIMIT 1`);
      if (!p.length || p[0].stato !== "attesa" || perBeneficenza(p[0])) { res.status(404).json({ error: "patto non trovato o gia' firmato" }); return; }
      if (p[0].autoreSub === who.sub) { res.status(409).json({ error: "il garante deve essere un'altra persona" }); return; }
      await rows(sql`UPDATE focuslock_patti SET garanteSub = ${who.sub}, garanteNome = ${pulisci(b.nome || who.name || p[0].garanteNome || "", 60) || null}, garanteEmail = ${who.email}, stato = 'attivo', firmatoAt = NOW() WHERE id = ${p[0].id} AND stato = 'attesa'`);
      const q = await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${p[0].id} LIMIT 1`);
      res.json({ patto: await vistaPatto(q[0], who.sub) });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* il verdetto di un giorno, dal telefono di chi si impegna: { id, giorno, esito, dettaglio } */
  app.post("/api/focuslock/patti/giorno", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const b = req.body || {};
    const esito = b.esito === "rispettato" ? "rispettato" : b.esito === "mancato" ? "mancato" : "";
    if (!esito || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.giorno || ""))) { res.status(400).json({ error: "verdetto non valido" }); return; }
    try {
      await ensureTables();
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${Number(b.id)} AND autoreSub = ${who.sub} AND stato = 'attivo' LIMIT 1`);
      if (!p.length) { res.status(404).json({ error: "patto non attivo" }); return; }
      const ab: Abitudine = JSON.parse(p[0].abitudine);
      const g = String(b.giorno);
      if (!giorniPrevisti(ab, String(p[0].daGiorno), String(p[0].aGiorno)).includes(g)) { res.status(400).json({ error: "quel giorno non e' nel patto" }); return; }
      if (giornoDi(Date.now()) < g) { res.status(400).json({ error: "quel giorno non e' ancora arrivato" }); return; }
      const c = await rows(sql`SELECT esito FROM focuslock_patti_giorni WHERE pattoId = ${p[0].id} AND giorno = ${g} LIMIT 1`);
      /* il primo verdetto vale; "nessun dato" si corregge se il telefono arriva tardi */
      if (c.length && c[0].esito !== "nessundato") { res.json({ ok: true, gia: c[0].esito }); return; }
      const dett = pulisci(b.dettaglio, 300) || null;
      if (esito === "rispettato") {
        await rows(sql`INSERT INTO focuslock_patti_giorni (pattoId, giorno, esito, dettaglio, importo, at) VALUES (${p[0].id}, ${g}, 'rispettato', ${dett}, 0, NOW())
          ON DUPLICATE KEY UPDATE esito = 'rispettato', dettaglio = VALUES(dettaglio), at = NOW()`);
        res.json({ ok: true, esito });
        return;
      }
      const imp = importoGiorno(Number(p[0].posta), Number(p[0].tetto), await giaNelMese(Number(p[0].id), g));
      const pag = imp > 0 ? await addebita(p[0], g, imp) : { id: "", stato: "tetto" };
      await rows(sql`INSERT INTO focuslock_patti_giorni (pattoId, giorno, esito, dettaglio, importo, pagamento, statoPagamento, at) VALUES (${p[0].id}, ${g}, 'mancato', ${dett}, ${imp}, ${pag.id || null}, ${pag.stato}, NOW())
        ON DUPLICATE KEY UPDATE esito = 'mancato', dettaglio = VALUES(dettaglio), importo = VALUES(importo), pagamento = VALUES(pagamento), statoPagamento = VALUES(statoPagamento), at = NOW()`);
      res.json({ ok: true, esito, importo: imp, statoPagamento: pag.stato });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* il garante scioglie il patto (chi si impegna non puo' farlo da solo: e' il senso del patto) */
  app.post("/api/focuslock/patti/sciogli", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const id = Number((req.body || {}).id);
    try {
      await ensureTables();
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${id} LIMIT 1`);
      if (!p.length) { res.status(404).json({ error: "patto non trovato" }); return; }
      /* 0.9.302: un patto verso la beneficenza non ha garante: lo scioglie chi si impegna (nell'app, solo dopo l'attesa
         del contratto di abitudine) */
      const autoreInAttesa = p[0].autoreSub === who.sub && (p[0].stato === "attesa" || perBeneficenza(p[0]));
      if (p[0].garanteSub !== who.sub && !autoreInAttesa) { res.status(403).json({ error: "solo il garante scioglie un patto firmato" }); return; }
      await rows(sql`UPDATE focuslock_patti SET stato = ${p[0].stato === "attesa" ? "annullato" : "sciolto"} WHERE id = ${id}`);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* la carta di chi si impegna (Stripe Checkout, modalita' setup): un indirizzo da aprire nel browser */
  app.post("/api/focuslock/patti/carta", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    if (!stripeAcceso()) { res.status(503).json({ error: "pagamenti non ancora collegati" }); return; }
    const id = Number((req.body || {}).id);
    try {
      await ensureTables();
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${id} AND autoreSub = ${who.sub} LIMIT 1`);
      if (!p.length) { res.status(404).json({ error: "patto non trovato" }); return; }
      let cliente = p[0].stripeCliente;
      if (!cliente) { const c = await stripe("customers", { email: who.email || undefined, name: p[0].autoreNome || undefined, metadata: { googleSub: who.sub } }); cliente = c.id; }
      const s = await stripe("checkout/sessions", { mode: "setup", customer: cliente, currency: "eur", "payment_method_types[0]": "card",
        success_url: BASE() + "/api/focuslock/patti/ritorno?ok=1", cancel_url: BASE() + "/api/focuslock/patti/ritorno?ok=0", metadata: { patto: String(id) } });
      await rows(sql`UPDATE focuslock_patti SET stripeCliente = ${cliente}, stripeSessione = ${s.id} WHERE id = ${id}`);
      res.json({ url: s.url });
    } catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });

  /* il conto del garante (Stripe Connect Express): la pagina di Stripe dove mette i suoi dati */
  app.post("/api/focuslock/patti/conto", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    if (!stripeAcceso()) { res.status(503).json({ error: "pagamenti non ancora collegati" }); return; }
    const id = Number((req.body || {}).id);
    try {
      await ensureTables();
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${id} AND garanteSub = ${who.sub} LIMIT 1`);
      if (!p.length) { res.status(404).json({ error: "patto non trovato" }); return; }
      let conto = p[0].stripeConto;
      if (!conto) {
        const a = await stripe("accounts", { type: "express", country: "IT", email: who.email || undefined, business_type: "individual", capabilities: { transfers: { requested: true } }, metadata: { googleSub: who.sub } });
        conto = a.id;
        await rows(sql`UPDATE focuslock_patti SET stripeConto = ${conto} WHERE id = ${id}`);
      }
      const l = await stripe("account_links", { account: conto, refresh_url: BASE() + "/api/focuslock/patti/ritorno?ok=0", return_url: BASE() + "/api/focuslock/patti/ritorno?ok=1", type: "account_onboarding" });
      res.json({ url: l.url });
    } catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });

  /* tornando dalla pagina di Stripe: la carta salvata si legge dalla sessione */
  app.post("/api/focuslock/patti/aggiorna-pagamento", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    if (!stripeAcceso()) { res.json({ ok: false }); return; }
    const id = Number((req.body || {}).id);
    try {
      await ensureTables();
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${id} AND (autoreSub = ${who.sub} OR garanteSub = ${who.sub}) LIMIT 1`);
      if (!p.length) { res.status(404).json({ error: "patto non trovato" }); return; }
      if (p[0].autoreSub === who.sub && p[0].stripeSessione && !p[0].stripeMetodo) {
        const s = await stripe("checkout/sessions/" + p[0].stripeSessione, {}, "GET");
        if (s.setup_intent) {
          const si = await stripe("setup_intents/" + s.setup_intent, {}, "GET");
          if (si.payment_method) await rows(sql`UPDATE focuslock_patti SET stripeMetodo = ${String(si.payment_method)} WHERE id = ${id}`);
        }
      }
      const q = await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${id} LIMIT 1`);
      let contoPronto = false;
      if (q[0].stripeConto) { try { const a = await stripe("accounts/" + q[0].stripeConto, {}, "GET"); contoPronto = a?.capabilities?.transfers === "active"; } catch { contoPronto = false; } }
      res.json({ patto: await vistaPatto(q[0], who.sub), contoPronto });
    } catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });

  app.get("/api/focuslock/patti/ritorno", (req: Request, res: Response) => {
    const ok = req.query.ok === "1";
    res.type("html").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DreamMap</title>
<body style="font-family:system-ui;background:#F4F9FF;color:#001E44;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">
<div><div style="font-size:48px">${ok ? "✅" : "↩️"}</div><h2>${ok ? "Fatto" : "Non e' cambiato niente"}</h2><p>Torna su DreamMap: il patto si aggiorna da solo.</p></div></body>`);
  });
}
